import { DatabaseSync } from "node:sqlite";
import { DEFAULT_ODDS_MAX_AGE_MS } from "../db/repository";
import { saveReferenceMarkets } from "../db/reference";
import { getTennisTargets, saveTennisSource, TennisTarget } from "../db/tennisReference";
import { fetchExchangePrices, MarketPrices } from "./exchange";
import {
  fetchTennisMarkets,
  placeTennisMatch,
  playerSearchTerm,
  searchTennis,
  TennisExchangeEvent,
  TennisMarkets,
  tennisPoints,
  tennisPrices,
} from "./tennis";

// The reference for the main tours' tennis matches of the next 48 hours,
// after the football one in the worker's reference cycle: each match is
// searched on the exchange once by a player's surname, its markets there
// listed every half hour (the exchange adds lines as the match nears), and
// all of them priced every cycle.

const HORIZON_MS = 48 * 60 * 60 * 1000;
const MAX_SEARCHES_PER_CYCLE = 40;
const RETRY_NOT_FOUND_MS = 30 * 60 * 1000;
const MARKETS_REFRESH_MS = 30 * 60 * 1000;

export interface TennisReferenceOptions {
  search?: (query: string) => Promise<TennisExchangeEvent[]>;
  markets?: (exchangeEventId: string) => Promise<TennisMarkets | undefined>;
  prices?: (markets: { marketId: string; eventId: string }[]) => Promise<Map<string, MarketPrices>>;
  now?: Date;
  oddsMaxAgeMs?: number;
  // When each match was last searched for in vain, across cycles.
  searchedAt?: Map<string, number>;
}

const searchedInVain = new Map<string, number>();

// Places the targets not found yet: by the first player's surname, then the
// second's.
async function findNew(
  db: DatabaseSync,
  targets: TennisTarget[],
  search: (query: string) => Promise<TennisExchangeEvent[]>,
  now: number,
  searchedAt: Map<string, number>
): Promise<{ searches: number; found: number }> {
  const results = new Map<string, TennisExchangeEvent[]>();
  let searches = 0;
  let found = 0;
  for (const target of targets) {
    if (target.source || now - (searchedAt.get(target.eventId) ?? 0) < RETRY_NOT_FOUND_MS) continue;
    if (searches >= MAX_SEARCHES_PER_CYCLE) break;
    for (const name of target.participants) {
      const term = playerSearchTerm(name);
      if (!term) continue;
      if (!results.has(term)) {
        searches++;
        try {
          results.set(term, await search(term));
        } catch (err) {
          console.error(`[reference:tennis] search "${term}" failed:`, err);
          results.set(term, []);
        }
      }
      const placed = placeTennisMatch(target.participants, results.get(term) ?? []);
      if (placed) {
        target.source = {
          exchangeEventId: placed.event.eventId,
          reversed: placed.reversed,
          participants: target.participants,
        };
        saveTennisSource(db, target.eventId, target.source, new Date(now).toISOString());
        found++;
        break;
      }
    }
    if (target.source) searchedAt.delete(target.eventId);
    else searchedAt.set(target.eventId, now);
  }
  return { searches, found };
}

export async function runTennisReferenceCycle(db: DatabaseSync, opts: TennisReferenceOptions = {}): Promise<void> {
  const search = opts.search ?? searchTennis;
  const listMarkets = opts.markets ?? fetchTennisMarkets;
  const prices = opts.prices ?? ((markets) => fetchExchangePrices(markets));
  const now = (opts.now ?? new Date()).getTime();
  const targets = getTennisTargets(db, {
    from: new Date(now).toISOString(),
    to: new Date(now + HORIZON_MS).toISOString(),
    oddsSince: new Date(now - (opts.oddsMaxAgeMs ?? DEFAULT_ODDS_MAX_AGE_MS)).toISOString(),
  });
  if (targets.length === 0) return;

  const { searches, found } = await findNew(db, targets, search, now, opts.searchedAt ?? searchedInVain);
  const placed = targets.filter((t) => t.source);

  // Their markets, listed again every half hour; one that fails keeps the
  // last list.
  for (const target of placed) {
    const source = target.source!;
    if (source.listedAt && now - Date.parse(source.listedAt) < MARKETS_REFRESH_MS) continue;
    try {
      const markets = await listMarkets(source.exchangeEventId);
      if (!markets) continue;
      source.markets = markets;
      source.listedAt = new Date(now).toISOString();
      saveTennisSource(db, target.eventId, source, source.listedAt);
    } catch (err) {
      console.error(`[reference:tennis] markets of ${source.exchangeEventId} failed:`, err);
    }
  }

  const listed = placed.filter((t) => t.source!.markets);
  const read = listed.flatMap((t) =>
    t.source!.markets!.markets.map((m) => ({ marketId: m.marketId, eventId: t.source!.exchangeEventId }))
  );
  let outcomes = 0;
  let fair = 0;
  if (read.length > 0) {
    const markets = await prices(read);
    // The prices are as old as the end of their read.
    const scrapedAt = new Date().toISOString();
    for (const target of listed) {
      const rows = tennisPrices(tennisPoints(target.source!.markets!, target.source!.reversed), markets);
      // Not answered this time: its last prices stay, and age out.
      if (rows.length === 0) continue;
      saveReferenceMarkets(db, target.eventId, rows, scrapedAt);
      outcomes += rows.length;
      fair += rows.filter((r) => r.fair !== undefined).length;
    }
  }
  console.log(
    `[reference:tennis] ${targets.length} main-tour matches within 48 h, ${placed.length} on the exchange (${found} found now, ${searches} searches), ${read.length} markets read, ${fair} of ${outcomes} outcomes with fair odds`
  );
}
