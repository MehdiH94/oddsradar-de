import { DatabaseSync } from "node:sqlite";
import {
  getReferenceTargets,
  listedLines,
  ReferenceTargetRow,
  saveReferenceMarkets,
  saveReferenceSource,
} from "../db/reference";
import { DEFAULT_ODDS_MAX_AGE_MS } from "../db/repository";
import { basketballPoints, BasketballMarket, fetchBasketballMarkets } from "./basketball";
import { fetchExchangePrices, MarketPrices, searchEvents } from "./exchange";
import { searchTerm } from "./match";
import {
  EXCHANGE_SPORTS,
  parseSportSearch,
  placeSportEvent,
  REFERENCE_SPORTS,
  SportEvent,
  sportPrices,
} from "./sports";
import { playerSearchTerm, tennisPrices } from "./tennis";

// The reference for the other head-to-head sports' main market
// (./sports.ts), after football's and tennis's in the worker's reference
// cycle: each match of the next 48 hours is searched on the exchange once,
// by its sides' names, where it is listed is kept, and every cycle prices
// all those found, like football's (./run.ts).
//
// A basketball match has its handicap and total points too (./basketball.ts):
// listed every half hour, priced with the winner, and saved with it, as a
// write replaces all of a match's rows (saveReferenceMarkets).

const HORIZON_MS = 48 * 60 * 60 * 1000;
// Searches per cycle, every sport together, the soonest matches first.
const MAX_SEARCHES_PER_CYCLE = 60;
const RETRY_NOT_FOUND_MS = 30 * 60 * 1000;
const MARKETS_REFRESH_MS = 30 * 60 * 1000;

export interface SportsReferenceOptions {
  // The exchange's search, as it answers (./exchange.ts, searchEvents).
  search?: (query: string) => Promise<unknown>;
  prices?: (markets: { marketId: string; eventId: string }[]) => Promise<Map<string, MarketPrices>>;
  // A basketball match's handicap and total points on the exchange.
  markets?: (exchangeEventId: string) => Promise<BasketballMarket[]>;
  now?: Date;
  oddsMaxAgeMs?: number;
  // When each match was last searched for in vain, across cycles.
  searchedAt?: Map<string, number>;
  // Each basketball match's markets as listed, and when, across cycles.
  listings?: Map<string, BasketballListing>;
}

interface BasketballListing {
  exchangeEventId: string;
  markets: BasketballMarket[];
  listedAt: number;
}

const searchedInVain = new Map<string, number>();
const listedBasketball = new Map<string, BasketballListing>();

// What a side is searched by: a team's longest telling word ("lightning"),
// a fighter's surname.
function termOf(sport: string, name: string): string | undefined {
  return EXCHANGE_SPORTS[sport]?.names === "players" ? playerSearchTerm(name) : searchTerm(name);
}

// Places the targets not found yet: by their first side's name, then their
// second's.
async function findNew(
  db: DatabaseSync,
  targets: ReferenceTargetRow[],
  search: (query: string) => Promise<unknown>,
  now: number,
  searchedAt: Map<string, number>
): Promise<{ searches: number; found: number }> {
  const answers = new Map<string, unknown>();
  let searches = 0;
  let found = 0;
  // An exchange's match is one of ours only: a match already placed is no
  // candidate for another (16/10/2026, a U21 game 15 minutes after its first
  // team's, the same club names, took that match's prices).
  const taken = new Set(targets.flatMap((t) => (t.source ? [t.source.exchangeEventId] : [])));
  for (const target of targets) {
    if (target.source || now - (searchedAt.get(target.eventId) ?? 0) < RETRY_NOT_FOUND_MS) continue;
    if (searches >= MAX_SEARCHES_PER_CYCLE) break;
    const candidates: SportEvent[] = [];
    for (const name of target.participants) {
      const term = termOf(target.sport, name);
      if (!term) continue;
      if (!answers.has(term)) {
        searches++;
        try {
          answers.set(term, await search(term));
        } catch (err) {
          console.error(`[reference:sports] search "${term}" failed:`, err);
          answers.set(term, null);
        }
      }
      candidates.push(...parseSportSearch(answers.get(term), EXCHANGE_SPORTS[target.sport]).filter((c) => !taken.has(c.eventId)));
      const placed = placeSportEvent(target.sport, target, candidates);
      if (placed) {
        target.source = {
          exchangeEventId: placed.event.eventId,
          marketId: placed.event.marketId,
          selections: placed.selections,
          participants: target.participants,
        };
        saveReferenceSource(db, target.eventId, target.source, new Date(now).toISOString());
        taken.add(placed.event.eventId);
        found++;
        break;
      }
    }
    if (target.source) searchedAt.delete(target.eventId);
    else searchedAt.set(target.eventId, now);
  }
  return { searches, found };
}

// The handicap and total points of the basketball matches placed, listed again
// every half hour; one that fails keeps its last list.
async function listBasketball(
  placed: ReferenceTargetRow[],
  listMarkets: (exchangeEventId: string) => Promise<BasketballMarket[]>,
  listings: Map<string, BasketballListing>,
  now: number
): Promise<void> {
  for (const target of placed) {
    if (target.sport !== "basketball") continue;
    const exchangeEventId = target.source!.exchangeEventId;
    const known = listings.get(target.eventId);
    if (known && known.exchangeEventId === exchangeEventId && now - known.listedAt < MARKETS_REFRESH_MS) continue;
    try {
      listings.set(target.eventId, { exchangeEventId, markets: await listMarkets(exchangeEventId), listedAt: now });
    } catch (err) {
      console.error(`[reference:sports] markets of ${exchangeEventId} failed:`, err);
    }
  }
}

export async function runSportsReferenceCycle(db: DatabaseSync, opts: SportsReferenceOptions = {}): Promise<void> {
  const search = opts.search ?? searchEvents;
  const listMarkets = opts.markets ?? fetchBasketballMarkets;
  const listings = opts.listings ?? listedBasketball;
  const prices = opts.prices ?? ((markets) => fetchExchangePrices(markets));
  const now = (opts.now ?? new Date()).getTime();
  const targets = getReferenceTargets(db, {
    from: new Date(now).toISOString(),
    to: new Date(now + HORIZON_MS).toISOString(),
    oddsSince: new Date(now - (opts.oddsMaxAgeMs ?? DEFAULT_ODDS_MAX_AGE_MS)).toISOString(),
    sports: REFERENCE_SPORTS,
  });
  if (targets.length === 0) return;

  const { searches, found } = await findNew(db, targets, search, now, opts.searchedAt ?? searchedInVain);
  const placed = targets.filter((t) => t.source);
  const fair = new Set<string>();
  if (placed.length > 0) {
    await listBasketball(placed, listMarkets, listings, now);
    // A basketball match's lines some bookmaker lists: the exchange's 72
    // handicap lines and 141 totals are compared with those only.
    const lines = new Map(
      placed
        .filter((t) => listings.get(t.eventId)?.exchangeEventId === t.source!.exchangeEventId)
        .map((t) => [t.eventId, listedLines(db, t.eventId, ["spread", "total_points"])] as const)
    );
    const basketball = (t: ReferenceTargetRow) => (lines.get(t.eventId)?.size ? listings.get(t.eventId)!.markets : []);
    const markets = await prices(
      placed.flatMap((t) => [
        { marketId: t.source!.marketId, eventId: t.source!.exchangeEventId },
        ...basketball(t).map((m) => ({ marketId: m.marketId, eventId: t.source!.exchangeEventId })),
      ])
    );
    // The prices are as old as the end of their read.
    const scrapedAt = new Date().toISOString();
    for (const target of placed) {
      const rows = sportPrices(
        EXCHANGE_SPORTS[target.sport],
        target.source!.selections,
        markets.get(target.source!.marketId)
      );
      // Not answered this time: its last prices stay, and age out.
      if (rows.length === 0) continue;
      const lineRows = tennisPrices(basketballPoints(basketball(target), target.source!.selections, lines.get(target.eventId)), markets);
      saveReferenceMarkets(db, target.eventId, [...rows, ...lineRows], scrapedAt);
      if (rows.some((r) => r.fair !== undefined)) fair.add(target.eventId);
    }
  }
  const bySport = REFERENCE_SPORTS.flatMap((sport) => {
    const ofSport = targets.filter((t) => t.sport === sport);
    if (ofSport.length === 0) return [];
    const onExchange = ofSport.filter((t) => t.source);
    return [`${sport} ${ofSport.length}/${onExchange.length}/${onExchange.filter((t) => fair.has(t.eventId)).length}`];
  });
  console.log(
    `[reference:sports] matches within 48 h / on the exchange / with fair odds: ${bySport.join(", ")} (${found} found now, ${searches} searches)`
  );
}
