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
// price among the given bookmakers (all of them when omitted):
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

export function payoutRate(event: EventWithOdds, bookmakers?: readonly string[]): number | null {
  const market = primaryMarket(event);
  if (!market) return null;
  if (market === MARKET_OUTRIGHT) return outrightPayoutRate(event, bookmakers);

  const hasDraw = Object.values(event.byBookmaker).some(({ odds }) =>
    odds.some((o) => o.market === market && o.selection === "X")
  );

  let impliedProbabilities = 0;
  for (const outcome of hasDraw ? OUTCOMES_WITH_DRAW : OUTCOMES_WITHOUT_DRAW) {
    let best = 0;
    for (const [bookmaker, { odds }] of Object.entries(event.byBookmaker)) {
      if (bookmakers && !bookmakers.includes(bookmaker)) continue;
      const price = odds.find((o) => o.market === market && o.selection === outcome)?.price ?? 0;
      if (price > best) best = price;
    }
    if (best === 0) return null;
    impliedProbabilities += 1 / best;
  }
  return 1 / impliedProbabilities;
}
