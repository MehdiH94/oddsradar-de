import { DatabaseSync } from "node:sqlite";
import { compareOutcomes, mainMarketLabel, marketLabel, outcomeLabel, parseMarketKey, winnersOf } from "../markets/catalog";
import { MARKET_1X2, MARKET_MATCH_WINNER, MARKET_OUTRIGHT } from "../scraper/canonical";
import { Grid, mainOutcomeLabel, outrightRateOf, payoutRateOf } from "./marketGrid";
import { inChunks } from "./playerReference";
import { loadBookmakerLinks } from "./bookmakerLinks";
import { primaryMarket } from "./payoutRate";
import { EventWithOdds } from "../types";
import { countMarkets, ListingOptions, loadEvents, marketsCutoff, matchingEventIds, oddsCutoff } from "./repository";

// The surebets of the matches and races not started yet: every market whose
// best prices guarantee a profit, whatever the outcome (the dashboard's
// "Value bets" category, src/alerts/gems.ts). Three kinds:
// - "bookmakers": Winamax's and Betclic's best prices, by the TRJ of a match's
//   page (./marketGrid.ts): every outcome covered, the same ones at each;
// - "exchange": the exchange's back prices too, net of its commission, where
//   it prices every outcome with money on each;
// - "lay": one outcome backed at a bookmaker and laid on the exchange (a
//   player's market as well, which has no TRJ of its own).

// The source of an exchange's leg, beside the bookmakers'.
export const EXCHANGE = "exchange";
// Its commission on a market's net winnings: 3% on Piwi247, as the account
// pays it. The guest feed only shows the market's base rate (2%,
// tests/reference/fixtures/exchange-search.json.gz), not what is charged.
export const EXCHANGE_COMMISSION = 0.03;
// The money an exchange's price must offer to be one leg, in euros (the
// players' "shown" level, src/reference/exchange.ts).
export const SUREBET_MIN_SIZE = 20;
// A lay with less money than that is a "thin" surebet, shown with what it
// offers (9/10/2026: Unibet's 2-2 of Kosovo F. - Autriche F. at 100 against a
// lay at 85 with a few euros on it was only a value bet). Under it, the
// exchange takes no bet.
export const SUREBET_THIN_MIN_SIZE = 2;
// Above it, a TRJ almost always comes from two bookmakers' different rules
// or lines, or an old price: shown, to be checked.
export const SUREBET_TO_VERIFY = 1.1;
// A leg whose price is this far from the other sources' for the same outcome,
// in chances (1 / price), is not the same bet: one source has the teams the
// other way round, another match, or an old price. Seen 20/10/2026: the
// exchange's lay of Avenida shown as Chartres' (1.64 against 2.40 to 2.54 at
// the bookmakers, a "surebet" of 144.9 %), and Betway's 9.47 on K Olsa Brakel
// (W) where 20bet paid 2.07 (154.3 %). A real surebet's prices differ by a
// few points of chance; a longshot's 15 against 9 by 4.
export const SUREBET_OUT_OF_LINE = 0.15;
// What a surebet's stakes and profit are given for.
const TOTAL_STAKE = 100;
// The matches whose prices are read at once.
const SUREBET_CHUNK = 500;

export type SurebetKind = "bookmakers" | "exchange" | "lay";

export interface SurebetLeg {
  selection: string;
  label: string;
  // A bookmaker ("winamax", "vbet"...) or EXCHANGE.
  source: string;
  side: "back" | "lay";
  // As the source shows it (the exchange's before its commission).
  price: number;
  // A back's stake out of TOTAL_STAKE; a lay's stake against the back's
  // TOTAL_STAKE, and what it risks (`liability`).
  stake: number;
  liability?: number;
  // A lay's money offered on the exchange, in euros (under SUREBET_MIN_SIZE,
  // the surebet is thin: only that much can be laid).
  size?: number;
  // A bookmaker's back: the match's page at the bookmaker, when its address
  // can be built (./bookmakerLinks.ts), to check the price there.
  url?: string;
  // The reference market's prices of this outcome, the exchange's back and
  // lay and the money on each, when it prices it: what the leg is measured
  // against, shown always (the owner, 24/10/2026).
  exchange?: ExchangeOutcome;
  // When this price was read (legReadAt), so that a price read long before
  // the others' shows (the owner, 22/10/2026: a 20bet price may have moved).
  readAt?: string;
}

export interface Surebet {
  eventId: string;
  sport: string;
  competition: string;
  startTime: string;
  participants: string[];
  marketCount: number;
  market: string;
  marketLabel: string;
  kind: SurebetKind;
  // Above 1: TOTAL_STAKE returns this many times itself, whatever happens.
  payoutRate: number;
  // The profit on TOTAL_STAKE, in euros.
  profit: number;
  toVerify: boolean;
  // A leg has under SUREBET_MIN_SIZE on the exchange: the profit holds for
  // what it offers only.
  thin: boolean;
  legs: SurebetLeg[];
  // Left out as out of line, and shown anyway when asked for (withSuspects):
  // a leg's price far from the other sources' (SUREBET_OUT_OF_LINE), their
  // median price of that outcome. A real price at times, to check.
  suspect?: { leg: SurebetLeg; others: number };
}

export type SurebetSort = "value" | "start";

// A surebet left out because one leg's price is out of line with the other
// sources' (SUREBET_OUT_OF_LINE): its leg, and the others' median price of
// that outcome. The admins' Discord is told about it (src/alerts/quality.ts):
// a swapped or stale price, or a real one the owner wants to know of
// (24/10/2026). The site shows it marked (getSurebets' withSuspects).
export interface SuspectSurebet extends Surebet {
  suspect: { leg: SurebetLeg; others: number };
}

export interface ExchangeOutcome {
  back?: number;
  backSize?: number;
  lay?: number;
  laySize?: number;
}

// The exchange's current prices of the given matches: event -> market ->
// outcome. A football 1X2's (reference_odds), a tennis match's every market
// and the other sports' main one (reference_markets), the players'
// (reference_player_odds, by the bookmakers' names of the players).
export function loadExchangeOutcomes(
  db: DatabaseSync,
  ids: readonly string[],
  since: string
): Map<string, Map<string, Map<string, ExchangeOutcome>>> {
  const rows = [
    ...inChunks(
      db,
      ids,
      `SELECT event_id AS eventId, '${MARKET_1X2}' AS market, selection, back, lay, back_size AS backSize, lay_size AS laySize
       FROM reference_odds WHERE event_id IN`,
      { since },
      "AND scraped_at >= @since"
    ),
    ...inChunks(
      db,
      ids,
      `SELECT event_id AS eventId, market, selection, back, lay, back_size AS backSize, lay_size AS laySize
       FROM reference_markets WHERE event_id IN`,
      { since },
      "AND scraped_at >= @since"
    ),
    ...inChunks(
      db,
      ids,
      `SELECT event_id AS eventId, market, player AS selection, back, lay, back_size AS backSize, lay_size AS laySize
       FROM reference_player_odds WHERE event_id IN`,
      { since },
      "AND player IS NOT NULL AND scraped_at >= @since"
    ),
  ] as {
    eventId: string;
    market: string;
    selection: string;
    back: number | null;
    lay: number | null;
    backSize: number | null;
    laySize: number | null;
  }[];
  const byEvent = new Map<string, Map<string, Map<string, ExchangeOutcome>>>();
  for (const r of rows) {
    if (!byEvent.has(r.eventId)) byEvent.set(r.eventId, new Map());
    const byMarket = byEvent.get(r.eventId)!;
    if (!byMarket.has(r.market)) byMarket.set(r.market, new Map());
    byMarket.get(r.market)!.set(r.selection, {
      ...(r.back !== null ? { back: r.back } : {}),
      ...(r.backSize !== null ? { backSize: r.backSize } : {}),
      ...(r.lay !== null ? { lay: r.lay } : {}),
      ...(r.laySize !== null ? { laySize: r.laySize } : {}),
    });
  }
  return byEvent;
}

// The exchange's prices of a market, to show beside a bet on it: its main
// market's are stored as the 1X2's, a winner's included.
export function referenceOutcomes(
  byMarket: Map<string, Map<string, ExchangeOutcome>> | undefined,
  market: string
): Map<string, ExchangeOutcome> | undefined {
  return byMarket?.get(market) ?? (market === MARKET_MATCH_WINNER ? byMarket?.get(MARKET_1X2) : undefined);
}

// Each bet the exchange's prices of its outcome, when it prices it (the
// value bets' list: what each is measured against, the owner, 24/10/2026).
export function withExchangePrices<T extends { eventId: string; market: string; selection: string }>(
  db: DatabaseSync,
  bets: readonly T[],
  opts: ListingOptions = {}
): (T & { exchange?: ExchangeOutcome })[] {
  const exchange = loadExchangeOutcomes(db, [...new Set(bets.map((b) => b.eventId))], oddsCutoff(opts));
  return bets.map((bet) => {
    const prices = referenceOutcomes(exchange.get(bet.eventId), bet.market)?.get(bet.selection);
    return prices?.back !== undefined || prices?.lay !== undefined ? { ...bet, exchange: { ...prices } } : bet;
  });
}

// Each match of the matches' lists the exchange's prices of its main market's
// outcomes, by outcome, when it prices them (the owner, 25/10/2026: the
// reference market on the "Spiele" list too).
export function withMatchExchangePrices<T extends EventWithOdds>(
  db: DatabaseSync,
  events: readonly T[],
  opts: ListingOptions = {}
): (T & { exchange?: Record<string, ExchangeOutcome> })[] {
  const exchange = loadExchangeOutcomes(db, events.map((e) => e.id), oddsCutoff(opts));
  return events.map((event) => {
    const market = primaryMarket(event);
    const outcomes = market ? referenceOutcomes(exchange.get(event.id), market) : undefined;
    const priced = [...(outcomes ?? [])].filter(([, p]) => p.back !== undefined || p.lay !== undefined);
    return priced.length > 0 ? { ...event, exchange: Object.fromEntries(priced.map(([k, p]) => [k, { ...p }])) } : event;
  });
}

// A back price on the exchange, net of its commission on the winnings.
export const netBack = (price: number) => 1 + (price - 1) * (1 - EXCHANGE_COMMISSION);

// Backing at `back` and laying the same outcome at `lay`, the lay stake set
// so that both cases pay the same: what the back stake returns, net of the
// commission on the lay's winnings.
export const backLayRate = (back: number, lay: number) => (back * (1 - EXCHANGE_COMMISSION)) / (lay - EXCHANGE_COMMISSION);

// How a market and its outcomes read (src/markets/catalog.ts).
function labelsOf(market: string, participants: string[], sport: string): { market: string; outcome: (key: string) => string } {
  const parsed = parseMarketKey(market);
  if (parsed.kind === "family") {
    return {
      market: marketLabel(parsed.family, participants, parsed.line),
      outcome: (key) => outcomeLabel(parsed.family.key, key, participants, parsed.line),
    };
  }
  if (market === MARKET_1X2 || market === MARKET_MATCH_WINNER) {
    return { market: mainMarketLabel(market, sport), outcome: (key) => mainOutcomeLabel(key, participants) };
  }
  // A race's or a tournament's winner: its outcomes are the competitors.
  return { market: mainMarketLabel(market, sport), outcome: (key) => key };
}

// A market's TRJ, by the rule of its kind.
function rateOf(market: string, grid: Grid): number | null {
  return market === MARKET_OUTRIGHT ? outrightRateOf(grid) : payoutRateOf(parseMarketKey(market), grid);
}

// The legs of a TRJ above 1: each outcome at its best price (a bookmaker's
// before the exchange's at the same net price), the stakes in proportion to
// 1/price so that every outcome pays TOTAL_STAKE × rate.
function backLegs(
  market: string,
  grid: Grid,
  rate: number,
  label: (key: string) => string,
  exchangeRaw: Map<string, number>
): SurebetLeg[] {
  const legs = [...grid].map(([selection, prices]) => {
    const [source, price] = [...prices].reduce((best, entry) =>
      entry[1] > best[1] || (entry[1] === best[1] && best[0] === EXCHANGE) ? entry : best
    );
    return {
      selection,
      label: label(selection),
      source,
      side: "back" as const,
      price: source === EXCHANGE ? exchangeRaw.get(selection)! : price,
      stake: (TOTAL_STAKE * rate) / price,
    };
  });
  // In the page's order: 1, X, 2, a family's own; a race's favourites first.
  const parsed = parseMarketKey(market);
  return legs.sort((a, b) =>
    market === MARKET_OUTRIGHT
      ? a.price - b.price || a.selection.localeCompare(b.selection, "fr")
      : compareOutcomes(parsed.kind === "family" ? parsed.family.key : MARKET_1X2, a.selection, b.selection)
  );
}

// `withSuspects`: the surebets left out as out of line too, each with its
// `suspect` (the site's list, never the testers' alerts).
export function getSurebets(
  db: DatabaseSync,
  opts: { q?: string; sort?: SurebetSort; bookmakers?: readonly string[]; withSuspects?: boolean } & ListingOptions = {}
): Surebet[] {
  const oddsSince = oddsCutoff(opts);
  const marketsSince = marketsCutoff(opts);
  const ids = matchingEventIds(db, undefined, opts.q, oddsSince);
  const surebets: Surebet[] = [];
  const suspects: SuspectSurebet[] | undefined = opts.withSuspects ? [] : undefined;
  for (let start = 0; start < ids.length; start += SUREBET_CHUNK) {
    const chunk = ids.slice(start, start + SUREBET_CHUNK);
    for (const surebet of surebetsOf(db, chunk, oddsSince, marketsSince, opts.bookmakers, suspects)) surebets.push(surebet);
  }
  surebets.push(...(suspects ?? []));
  const counts = countMarkets(db, [...new Set(surebets.map((s) => s.eventId))], oddsSince, marketsSince);
  for (const surebet of surebets) {
    surebet.marketCount = counts.get(surebet.eventId) ?? 0;
    for (const leg of surebet.legs) {
      const at = legReadAt(db, surebet, leg);
      if (at) leg.readAt = at;
    }
  }
  addBookmakerLinks(db, surebets);
  return surebets.sort((a, b) =>
    opts.sort === "start"
      ? a.startTime.localeCompare(b.startTime) || b.payoutRate - a.payoutRate
      : b.payoutRate - a.payoutRate || a.startTime.localeCompare(b.startTime)
  );
}

// The surebets left out because a leg is out of line (SuspectSurebet), every
// bookmaker's, by TRJ.
export function getSuspectSurebets(db: DatabaseSync, opts: ListingOptions = {}): SuspectSurebet[] {
  const oddsSince = oddsCutoff(opts);
  const marketsSince = marketsCutoff(opts);
  const ids = matchingEventIds(db, undefined, undefined, oddsSince);
  const suspects: SuspectSurebet[] = [];
  for (let start = 0; start < ids.length; start += SUREBET_CHUNK) {
    surebetsOf(db, ids.slice(start, start + SUREBET_CHUNK), oddsSince, marketsSince, undefined, suspects);
  }
  // When each leg was read, as on the site: an old price tells itself from a
  // real one at a glance (src/alerts/quality.ts).
  for (const suspect of suspects) {
    for (const leg of suspect.legs) {
      const at = legReadAt(db, suspect, leg);
      if (at) leg.readAt = at;
    }
  }
  addBookmakerLinks(db, suspects);
  return suspects.sort((a, b) => b.payoutRate - a.payoutRate);
}

// When a leg's price was read: a bookmaker's from the listing's or the markets
// cycle's prices, the exchange's from the reference's.
export function legReadAt(db: DatabaseSync, surebet: Pick<Surebet, "eventId" | "market">, leg: SurebetLeg): string | null {
  const args = { eventId: surebet.eventId, market: surebet.market, selection: leg.selection, source: leg.source };
  const queries =
    leg.source === EXCHANGE
      ? [
          surebet.market === MARKET_1X2
            ? "SELECT scraped_at AS at FROM reference_odds WHERE event_id = @eventId AND selection = @selection"
            : "SELECT scraped_at AS at FROM reference_markets WHERE event_id = @eventId AND market = @market AND selection = @selection",
          "SELECT scraped_at AS at FROM reference_player_odds WHERE event_id = @eventId AND market = @market AND player = @selection",
        ]
      : [
          "SELECT scraped_at AS at FROM event_bookmaker_odds WHERE event_id = @eventId AND bookmaker_id = @source AND market = @market AND selection = @selection",
          "SELECT scraped_at AS at FROM event_market_odds WHERE event_id = @eventId AND bookmaker_id = @source AND market = @market AND selection = @selection",
        ];
  for (const sql of queries) {
    const params = Object.fromEntries(Object.entries(args).filter(([key]) => sql.includes(`@${key}`)));
    const row = db.prepare(sql).get(params) as { at: string } | undefined;
    if (row) return row.at;
  }
  return null;
}

// A leg read this long before its surebet's newest leg is stale: its price may
// have moved since. The site marks it "älter" (web/src/SurebetsTable.tsx,
// OLDER_LEG_MS, the same 10 minutes: over the 5-minute cycle, under the
// markets cycle's 15) and the testers' alerts leave its surebet out.
export const STALE_LEG_MS = 10 * 60 * 1000;

// Whether a leg of the surebet was read over STALE_LEG_MS before its newest.
export function hasStaleLeg(surebet: Pick<Surebet, "legs">): boolean {
  const times = surebet.legs.flatMap((l) => (l.readAt ? [Date.parse(l.readAt)] : []));
  return times.length > 1 && Math.max(...times) - Math.min(...times) > STALE_LEG_MS;
}

// Each bookmaker's leg its match's page there, when it can be built.
function addBookmakerLinks(db: DatabaseSync, surebets: readonly Surebet[]): void {
  const links = loadBookmakerLinks(db, [...new Set(surebets.map((s) => s.eventId))]);
  for (const surebet of surebets) {
    for (const leg of surebet.legs) {
      const url = leg.source === EXCHANGE ? undefined : links.get(surebet.eventId)?.[leg.source];
      if (url) leg.url = url;
    }
  }
}

// None when they fail, logged: the value bets beside them still show, and
// still alert.
export function surebetsOrNone(db: DatabaseSync, opts: Parameters<typeof getSurebets>[1]): Surebet[] {
  try {
    return getSurebets(db, opts);
  } catch (err) {
    console.error("[surebets]", err);
    return [];
  }
}

// An outcome's price at a bookmaker: a value bet's (src/db/repository.ts,
// getValueBets).
interface PricedOutcome {
  eventId: string;
  market: string;
  selection: string;
  price: number;
}

// Whether a surebet of its match's market already holds this price: laid at
// a lay surebet's lay, it pays whatever happens too; in place of its
// outcome's back in a surebet of every outcome, the TRJ stays above 100%.
function heldBy(bet: PricedOutcome, surebet: Surebet): boolean {
  if (surebet.kind === "lay") {
    const lay = surebet.legs.find((l) => l.side === "lay" && l.selection === bet.selection);
    return lay !== undefined && backLayRate(bet.price, lay.price) > 1;
  }
  const leg = surebet.legs.find((l) => l.selection === bet.selection);
  if (!leg) return false;
  // The stakes return TOTAL_STAKE × payoutRate whatever happens: the other
  // outcomes' 1 / price add up to their share of the stakes over that.
  const others = (1 - leg.stake / TOTAL_STAKE) / surebet.payoutRate;
  return others + 1 / bet.price < 1;
}

// The value bets no surebet holds: a price that makes a surebet is shown as
// that surebet only, on the site and in the alerts (6/10/2026, before which
// it was both).
export function withoutSurebets<T extends PricedOutcome>(bets: readonly T[], surebets: readonly Surebet[]): T[] {
  const byMarket = new Map<string, Surebet[]>();
  for (const s of surebets) {
    const key = `${s.eventId}|${s.market}`;
    byMarket.set(key, [...(byMarket.get(key) ?? []), s]);
  }
  return bets.filter((bet) => !(byMarket.get(`${bet.eventId}|${bet.market}`) ?? []).some((s) => heldBy(bet, s)));
}

// The surebets of the given matches, without their markets' count.
function surebetsOf(
  db: DatabaseSync,
  ids: string[],
  oddsSince: string,
  marketsSince: string,
  bookmakers: readonly string[] | undefined,
  // Where the surebets left out as out of line go, when given.
  suspects?: SuspectSurebet[]
): Surebet[] {
  const events = loadEvents(db, ids, oddsSince, marketsSince);
  const exchange = loadExchangeOutcomes(db, ids, oddsSince);
  const ticked = (bookmaker: string) => !bookmakers || bookmakers.includes(bookmaker);

  // Every market's prices, the listing's main one and the markets cycle's.
  const grids = new Map<string, Map<string, Grid>>();
  const put = (eventId: string, bookmaker: string, market: string, selection: string, price: number) => {
    if (!ticked(bookmaker)) return;
    if (!grids.has(eventId)) grids.set(eventId, new Map());
    const byMarket = grids.get(eventId)!;
    if (!byMarket.has(market)) byMarket.set(market, new Map());
    const grid = byMarket.get(market)!;
    if (!grid.has(selection)) grid.set(selection, new Map());
    grid.get(selection)!.set(bookmaker, price);
  };
  for (const event of events) {
    for (const [bookmaker, { odds }] of Object.entries(event.byBookmaker)) {
      for (const o of odds) put(event.id, bookmaker, o.market, o.selection, o.price);
    }
  }
  // Of the markets cycle's, only those that paid above 100% when saved and
  // those the exchange prices: all of them are a million prices.
  const candidates = new Map<string, Set<string>>();
  const rows = inChunks(db, ids, "SELECT event_id AS eventId, market FROM surebet_markets WHERE event_id IN", {}) as {
    eventId: string;
    market: string;
  }[];
  for (const r of rows) {
    if (!candidates.has(r.eventId)) candidates.set(r.eventId, new Set());
    candidates.get(r.eventId)!.add(r.market);
  }
  for (const [eventId, byMarket] of exchange) {
    if (!candidates.has(eventId)) candidates.set(eventId, new Set());
    for (const market of byMarket.keys()) candidates.get(eventId)!.add(market);
  }
  const select = db.prepare(
    `SELECT bookmaker_id AS bookmaker, market, selection, price FROM event_market_odds
     WHERE event_id = @eventId AND market IN (SELECT value FROM json_each(@markets)) AND scraped_at >= @marketsSince`
  );
  for (const [eventId, markets] of candidates) {
    const rows = select.all({ eventId, markets: JSON.stringify([...markets]), marketsSince }) as {
      bookmaker: string;
      market: string;
      selection: string;
      price: number;
    }[];
    for (const r of rows) put(eventId, r.bookmaker, r.market, r.selection, r.price);
  }

  const surebets: Surebet[] = [];
  for (const event of events) {
    const match = {
      eventId: event.id,
      sport: event.sport,
      competition: event.competition,
      startTime: event.startTime,
      participants: event.participants,
      marketCount: 0,
    };
    const build = (market: string, label: string, kind: SurebetKind, payoutRate: number, legs: SurebetLeg[]): Surebet => ({
        ...match,
        market,
        marketLabel: label,
        kind,
        payoutRate,
        profit: TOTAL_STAKE * (payoutRate - 1),
        // A market of several winners (a golf Top N) pays on a tie for its
        // last place by each bookmaker's own rule: always to be checked.
        toVerify: payoutRate > SUREBET_TO_VERIFY || (winnersOf(parseMarketKey(market)) ?? 1) > 1,
        thin: legs.some((l) => l.size !== undefined && l.size < SUREBET_MIN_SIZE),
        legs,
      });

    for (const [market, grid] of grids.get(event.id) ?? []) {
      const labels = labelsOf(market, event.participants, event.sport);
      const onExchange = exchange.get(event.id)?.get(market);
      // A leg out of line with the other sources' prices of its outcome
      // (SUREBET_OUT_OF_LINE), and their median: a back against the other
      // bookmakers' and the exchange's back, a lay against the bookmakers'.
      const outOfLine = (leg: SurebetLeg): SuspectSurebet["suspect"] | undefined => {
        const others = [...(grid.get(leg.selection) ?? [])]
          .filter(([source]) => leg.side === "lay" || source !== leg.source)
          .map(([, price]) => price);
        const exchangeBack = onExchange?.get(leg.selection)?.back;
        if (leg.side === "back" && leg.source !== EXCHANGE && exchangeBack) others.push(exchangeBack);
        if (others.length === 0) return undefined;
        const line = median(others);
        return Math.abs(1 / leg.price - 1 / line) > SUREBET_OUT_OF_LINE ? { leg, others: line } : undefined;
      };
      // A surebet shown, or left out as a suspect when a leg is out of line.
      const add = (market: string, label: string, kind: SurebetKind, payoutRate: number, legs: SurebetLeg[]) => {
        // Every outcome at one bookmaker is its own mistake or its own odds
        // boost, not a surebet: at least two sources (the owner, 23/10/2026).
        if (new Set(legs.map((l) => l.source)).size < 2) return;
        const surebet = build(market, label, kind, payoutRate, legs);
        const reference = referenceOutcomes(exchange.get(event.id), market);
        for (const leg of surebet.legs.filter((l) => l.source !== EXCHANGE)) {
          const prices = reference?.get(leg.selection);
          if (prices?.back !== undefined || prices?.lay !== undefined) leg.exchange = { ...prices };
        }
        const suspect = legs.map(outOfLine).find((s) => s !== undefined);
        if (!suspect) surebets.push(surebet);
        else suspects?.push({ ...surebet, suspect });
      };

      // The bookmakers' best prices, and the exchange's back too when it
      // prices every outcome with money on each.
      let best: { grid: Grid; rate: number } | null = null;
      const rate = rateOf(market, grid);
      if (rate !== null && rate > 1) best = { grid, rate };
      const exchangeRaw = new Map<string, number>();
      const sized = (outcome: string) => (onExchange?.get(outcome)?.backSize ?? 0) >= SUREBET_MIN_SIZE;
      // The winner among N players (a golf tournament's) and its Top N have no
      // 20 EUR on every one of them: the exchange backs those that have it, the
      // bookmakers the others.
      const ofPlayers = market === MARKET_OUTRIGHT || winnersOf(parseMarketKey(market)) !== undefined;
      if (onExchange && (ofPlayers ? [...grid.keys()].some(sized) : [...grid.keys()].every(sized))) {
        const withExchange: Grid = new Map(
          [...grid].map(([selection, prices]) => {
            if (!sized(selection)) return [selection, prices];
            const back = onExchange.get(selection)!.back!;
            exchangeRaw.set(selection, back);
            return [selection, new Map([...prices, [EXCHANGE, netBack(back)]])];
          })
        );
        const mixed = rateOf(market, withExchange);
        if (mixed !== null && mixed > 1 && mixed > (best?.rate ?? 0) + 1e-12) best = { grid: withExchange, rate: mixed };
      }
      if (best) {
        const legs = backLegs(market, best.grid, best.rate, labels.outcome, exchangeRaw);
        add(market, labels.market, legs.some((l) => l.source === EXCHANGE) ? "exchange" : "bookmakers", best.rate, legs);
      }

      // Each outcome backed at its best bookmaker and laid on the exchange.
      for (const [selection, prices] of onExchange ? grid : []) {
        const lay = onExchange!.get(selection);
        if (!lay?.lay || (lay.laySize ?? 0) < SUREBET_THIN_MIN_SIZE || prices.size === 0) continue;
        const [bookmaker, price] = [...prices].reduce((a, b) => (b[1] > a[1] ? b : a));
        const layRate = backLayRate(price, lay.lay);
        if (layRate <= 1) continue;
        const layStake = (TOTAL_STAKE * price) / (lay.lay - EXCHANGE_COMMISSION);
        const layLeg: SurebetLeg = {
          selection,
          label: labels.outcome(selection),
          source: EXCHANGE,
          side: "lay",
          price: lay.lay,
          stake: layStake,
          liability: layStake * (lay.lay - 1),
          size: lay.laySize,
        };
        add(market, labels.market, "lay", layRate, [
          { selection, label: labels.outcome(selection), source: bookmaker, side: "back", price, stake: TOTAL_STAKE },
          layLeg,
        ]);
      }
    }
  }
  return surebets;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
