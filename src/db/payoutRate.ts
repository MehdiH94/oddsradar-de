import { EventWithOdds } from "../types";
import { MARKET_OUTRIGHT } from "../scraper/canonical";
import { Grid, outrightRateOf } from "./marketGrid";

const OUTCOMES_WITH_DRAW = ["1", "X", "2"];
const OUTCOMES_WITHOUT_DRAW = ["1", "2"];

// The market the dashboard compares across bookmakers (web/src/OddsTable.tsx,
// primaryMarket): the one most bookmakers list, the first bookmaker's first
// market on a tie. getLatestEvents orders each event's odds by bookmaker,
// market and selection, so the API and the dashboard settle on the same one.
// (Unibet's list gives a basketball match's result in regular time, a 1X2, where
// the others give the winner, overtime included: the winner is what four list.)
export function primaryMarket(event: EventWithOdds): string | null {
  const listedBy = new Map<string, number>();
  for (const { odds } of Object.values(event.byBookmaker)) {
    for (const market of new Set(odds.map((o) => o.market))) listedBy.set(market, (listedBy.get(market) ?? 0) + 1);
  }
  let primary: string | null = null;
  for (const [market, count] of listedBy) if (primary === null || count > listedBy.get(primary)!) primary = market;
  return primary;
}

// Taux de retour aux joueurs when every outcome of the match is bet at its best
// price among the given bookmakers (all of them when omitted), on two sites at
// least (bestAcrossSites):
// 1 / (1/price1 + 1/priceX + 1/price2), or over "1" and "2" only for a match
// with no draw price at any bookmaker (tennis, snooker...). Above 1, the best
// prices together guarantee a profit. Null when an outcome has no price among
// the given bookmakers: the rate is then undefined, not merely lower.
// A winner-among-N market (a race, a golf tournament): its competitors' best
// prices, by ./marketGrid.ts's rule (one bookmaker must list the whole field).
function outrightPayoutRate(event: EventWithOdds, bookmakers?: readonly string[]): number | null {
  const grid: Grid = new Map();
  for (const [bookmaker, { odds }] of Object.entries(event.byBookmaker)) {
    if (bookmakers && !bookmakers.includes(bookmaker)) continue;
    for (const o of odds) {
      if (o.market !== MARKET_OUTRIGHT) continue;
      if (!grid.has(o.selection)) grid.set(o.selection, new Map());
      grid.get(o.selection)!.set(bookmaker, o.price);
    }
  }
  return outrightRateOf(grid);
}

// For each outcome, its bookmakers' prices among the given ones, best first.
type OutcomePrices = { outcome: string; prices: { bookmaker: string; price: number }[] };

// The bookmakers at the best price of each outcome, so that they make at least
// two sites (the owner, 25/10/2026: every outcome of a match can't be bet at
// one bookmaker, like a surebet, #42). When every best price is at the same
// one, the outcome where another site costs the least goes to that site; with
// a single site pricing the match, none. For the TRJ only: the dashboard
// still ticks each outcome's highest price (web/src/bestOdds.ts,
// getBestPrices; the owner, 26/10/2026).
export function bestAcrossSites(outcomes: readonly OutcomePrices[]): Map<string, { bookmakers: string[]; price: number }> | null {
  const best = new Map<string, { bookmakers: string[]; price: number }>();
  for (const { outcome, prices } of outcomes) {
    if (prices.length === 0) return null;
    const top = Math.max(...prices.map((p) => p.price));
    best.set(outcome, { bookmakers: prices.filter((p) => p.price === top).map((p) => p.bookmaker), price: top });
  }
  const sites = new Set([...best.values()].flatMap((b) => b.bookmakers));
  if (sites.size !== 1 || outcomes.length < 2) return best;
  const [only] = sites;
  let swap: { outcome: string; bookmakers: string[]; price: number; cost: number } | undefined;
  for (const { outcome, prices } of outcomes) {
    const others = prices.filter((p) => p.bookmaker !== only);
    if (others.length === 0) continue;
    const top = Math.max(...others.map((p) => p.price));
    const cost = 1 / top - 1 / best.get(outcome)!.price;
    if (!swap || cost < swap.cost) swap = { outcome, bookmakers: others.filter((p) => p.price === top).map((p) => p.bookmaker), price: top, cost };
  }
  if (!swap) return null;
  best.set(swap.outcome, { bookmakers: swap.bookmakers, price: swap.price });
  return best;
}

export function payoutRate(event: EventWithOdds, bookmakers?: readonly string[]): number | null {
  const market = primaryMarket(event);
  if (!market) return null;
  if (market === MARKET_OUTRIGHT) return outrightPayoutRate(event, bookmakers);

  const hasDraw = Object.values(event.byBookmaker).some(({ odds }) =>
    odds.some((o) => o.market === market && o.selection === "X")
  );

  const outcomes = (hasDraw ? OUTCOMES_WITH_DRAW : OUTCOMES_WITHOUT_DRAW).map((outcome) => ({
    outcome,
    prices: Object.entries(event.byBookmaker).flatMap(([bookmaker, { odds }]) => {
      if (bookmakers && !bookmakers.includes(bookmaker)) return [];
      const price = odds.find((o) => o.market === market && o.selection === outcome)?.price ?? 0;
      return price > 0 ? [{ bookmaker, price }] : [];
    }),
  }));
  const best = bestAcrossSites(outcomes);
  if (!best) return null;
  return 1 / [...best.values()].reduce((sum, b) => sum + 1 / b.price, 0);
}
