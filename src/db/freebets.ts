import { DatabaseSync } from "node:sqlite";
import { ALL_BOOKMAKER_IDS } from "../alerts/gems";
import { BookmakerId, MARKET_1X2, MARKET_MATCH_WINNER } from "../scraper/canonical";
import { primaryMarket } from "./payoutRate";
import { ListingOptions, loadEvents, marketsCutoff, matchingEventIds, oddsCutoff } from "./repository";
import { loadExchangeOutcomes, SUREBET_THIN_MIN_SIZE } from "./surebets";

// What the Freebets page converts: the matches not started yet whose main market
// has 2 or 3 outcomes (a 1X2, a winner), with each bookmaker's prices on them and
// the exchange's lay prices. A race, a golf tournament (a winner among many)
// is not a match to cover three outcomes of: it is left out, and so is a sport
// with no such market, which the page never offers.

// How far ahead the page looks: a freebet usually lives a week.
export const FREEBET_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

// The outcomes of the two main markets, in the order of a match's page.
const OUTCOMES: Record<string, readonly string[]> = {
  [MARKET_1X2]: ["1", "X", "2"],
  [MARKET_MATCH_WINNER]: ["1", "2"],
};

// The matches whose prices are read at once (SQLite caps a statement's parameters).
const CHUNK = 500;

export interface FreebetMarket {
  eventId: string;
  sport: string;
  competition: string;
  startTime: string;
  participants: string[];
  // MARKET_1X2 or MARKET_MATCH_WINNER, and its outcomes ("1", "X", "2" or "1", "2").
  market: string;
  outcomes: readonly string[];
  // By bookmaker: its price on each outcome, in the order of `outcomes`. A
  // bookmaker that does not price every one of them is absent: it cannot cover
  // the match.
  prices: Partial<Record<BookmakerId, number[]>>;
  // When each of those bookmakers' prices were read.
  scrapedAt: Partial<Record<BookmakerId, string>>;
  // The exchange's lay price and the money offered at it, by outcome; none for an
  // outcome with no lay or not enough money to take a bet.
  exchange: Record<string, { lay: number; laySize: number }>;
}

// The matches of the next week with their current prices, soonest first. A match
// kept has at least two bookmakers pricing all its outcomes, or one of them and
// the exchange.
export function loadFreebetMarkets(db: DatabaseSync, opts: ListingOptions = {}): FreebetMarket[] {
  const oddsSince = oddsCutoff(opts);
  const marketsSince = marketsCutoff(opts);
  const startBefore = new Date(Date.now() + FREEBET_HORIZON_MS).toISOString();
  const ids = matchingEventIds(db, undefined, undefined, oddsSince, { startBefore });
  const known = new Set<string>(ALL_BOOKMAKER_IDS);
  const markets: FreebetMarket[] = [];
  for (let start = 0; start < ids.length; start += CHUNK) {
    const chunk = ids.slice(start, start + CHUNK);
    const exchange = loadExchangeOutcomes(db, chunk, oddsSince);
    for (const event of loadEvents(db, chunk, oddsSince, marketsSince)) {
      const market = primaryMarket(event);
      const outcomes = market === null ? undefined : OUTCOMES[market];
      if (market === null || !outcomes) continue;

      const prices: FreebetMarket["prices"] = {};
      const scrapedAt: FreebetMarket["scrapedAt"] = {};
      for (const [bookmaker, { scrapedAt: at, odds }] of Object.entries(event.byBookmaker)) {
        if (!known.has(bookmaker)) continue;
        const listed = outcomes.map((outcome) => odds.find((o) => o.market === market && o.selection === outcome)?.price);
        if (!listed.every((price) => price !== undefined && Number.isFinite(price) && price > 1)) continue;
        prices[bookmaker as BookmakerId] = listed as number[];
        scrapedAt[bookmaker as BookmakerId] = at;
      }

      const lays: FreebetMarket["exchange"] = {};
      for (const outcome of outcomes) {
        const side = exchange.get(event.id)?.get(market)?.get(outcome);
        if (side?.lay !== undefined && side.lay > 1 && (side.laySize ?? 0) >= SUREBET_THIN_MIN_SIZE) {
          lays[outcome] = { lay: side.lay, laySize: side.laySize! };
        }
      }

      const priced = Object.keys(prices).length;
      if (priced < 2 && !(priced === 1 && Object.keys(lays).length > 0)) continue;
      markets.push({
        eventId: event.id,
        sport: event.sport,
        competition: event.competition,
        startTime: event.startTime,
        participants: event.participants,
        market,
        outcomes,
        prices,
        scrapedAt,
        exchange: lays,
      });
    }
  }
  return markets;
}
