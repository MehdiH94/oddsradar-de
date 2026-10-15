import { DatabaseSync } from "node:sqlite";
import { getReferenceTargets, ReferenceTargetRow, saveReferenceOdds, saveReferenceSource } from "../db/reference";
import { DEFAULT_MARKETS_MAX_AGE_MS, DEFAULT_ODDS_MAX_AGE_MS } from "../db/repository";
import {
  ExchangeMatch,
  ExchangePlayerMarket,
  fairOdds,
  fetchEventPlayerMarkets,
  fetchExchangePrices,
  MarketPrices,
  Outcome,
  searchExchange,
} from "./exchange";
import { findOnExchange, searchTerm } from "./match";
import { ExchangeReadTotals, findPlayerMarkets, PlacedMatch, playerMarketsToPrice, recordPlayerPrices, recordPlayerSignals } from "./players";
import { recordPlayerCycle } from "../db/playerStats";

// The worker's third cycle: the reference's fair odds for the 1X2 of the
// football matches starting soon. A match is searched on the exchange once,
// by its teams' names; where the exchange lists it is kept, and every cycle
// prices all the matches found.

// Matches starting within this window, like the markets cycle.
const REFERENCE_HORIZON_MS = 48 * 60 * 60 * 1000;
// Searches per cycle: the first cycle searches every match, the next ones
// only the new ones and those not found yet.
const MAX_SEARCHES_PER_CYCLE = 80;
// A match not found on the exchange (it doesn't list it, or names it too
// differently) is searched again this long after.
const RETRY_NOT_FOUND_MS = 30 * 60 * 1000;

export interface ReferenceCycleOptions {
  search?: (query: string) => Promise<ExchangeMatch[]>;
  prices?: (markets: { marketId: string; eventId: string }[]) => Promise<Map<string, MarketPrices>>;
  // A match's players' markets on the exchange, by its event id there.
  playerMarkets?: (exchangeEventId: string) => Promise<ExchangePlayerMarket[]>;
  now?: Date;
  // How old a bookmaker's price may be for its match to count (the listing's),
  // and for a player's price to be compared (the markets cycle's).
  oddsMaxAgeMs?: number;
  marketsMaxAgeMs?: number;
  // When each match was last searched for in vain, across cycles.
  searchedAt?: Map<string, number>;
  // When each match's players' markets were last listed.
  playersCheckedAt?: Map<string, number>;
}

const searchedInVain = new Map<string, number>();
const playersListedAt = new Map<string, number>();

const OUTCOMES: Outcome[] = ["1", "X", "2"];

// Finds the targets not placed on the exchange yet, and keeps where they are.
async function findNewTargets(
  db: DatabaseSync,
  targets: ReferenceTargetRow[],
  search: (query: string) => Promise<ExchangeMatch[]>,
  now: number,
  searchedAt: Map<string, number>
): Promise<{ searches: number; found: number }> {
  const results = new Map<string, ExchangeMatch[]>();
  let searches = 0;
  let found = 0;
  for (const target of targets) {
    if (target.source || now - (searchedAt.get(target.eventId) ?? 0) < RETRY_NOT_FOUND_MS) continue;
    if (searches >= MAX_SEARCHES_PER_CYCLE) break;
    // The home team's name first, then the away team's.
    const candidates: ExchangeMatch[] = [];
    for (const name of target.participants) {
      const term = searchTerm(name);
      if (!term) continue;
      if (!results.has(term)) {
        searches++;
        try {
          results.set(term, await search(term));
        } catch (err) {
          console.error(`[reference] search "${term}" failed:`, err);
          results.set(term, []);
        }
      }
      candidates.push(...(results.get(term) ?? []));
      const match = findOnExchange(target, candidates);
      if (match) {
        target.source = {
          exchangeEventId: match.match.eventId,
          marketId: match.match.marketId,
          selections: match.selections,
          participants: target.participants,
        };
        saveReferenceSource(db, target.eventId, target.source, new Date(now).toISOString());
        found++;
        break;
      }
    }
    if (target.source) searchedAt.delete(target.eventId);
    else searchedAt.set(target.eventId, now);
  }
  return { searches, found };
}

export async function runReferenceCycle(db: DatabaseSync, opts: ReferenceCycleOptions = {}): Promise<void> {
  const search = opts.search ?? searchExchange;
  const prices = opts.prices ?? ((markets) => fetchExchangePrices(markets));
  const playerMarkets = opts.playerMarkets ?? fetchEventPlayerMarkets;
  const now = (opts.now ?? new Date()).getTime();
  const targets = getReferenceTargets(db, {
    from: new Date(now).toISOString(),
    to: new Date(now + REFERENCE_HORIZON_MS).toISOString(),
    oddsSince: new Date(now - (opts.oddsMaxAgeMs ?? DEFAULT_ODDS_MAX_AGE_MS)).toISOString(),
  });

  const { searches, found } = await findNewTargets(db, targets, search, now, opts.searchedAt ?? searchedInVain);

  const placed = targets.filter((t) => t.source);
  const placedMatches: PlacedMatch[] = placed.map((t) => ({ eventId: t.eventId, exchangeEventId: t.source!.exchangeEventId }));
  await findPlayerMarkets(db, placedMatches, playerMarkets, now, opts.playersCheckedAt ?? playersListedAt);
  const players = playerMarketsToPrice(db, placedMatches);

  let priced = 0;
  let read: ExchangeReadTotals = { matches: 0, markets: 0, runners: 0, priced: 0, loose: 0, shown: 0, spread: 0, strict: 0, players: 0 };
  if (placed.length > 0) {
    // The players' markets with the 1X2s, in one read.
    const markets = await prices([
      ...placed.map((t) => ({ marketId: t.source!.marketId, eventId: t.source!.exchangeEventId })),
      ...players.map(({ match, market }) => ({ marketId: market.marketId, eventId: match.exchangeEventId })),
    ]);
    // The prices are as old as the end of their read.
    const scrapedAt = new Date().toISOString();
    for (const target of placed) {
      const market = markets.get(target.source!.marketId);
      // Not answered this time: its last prices stay, and age out.
      if (!market) continue;
      const runners = Object.fromEntries(
        OUTCOMES.map((o) => [o, market.runners.get(target.source!.selections[o])])
      ) as Record<Outcome, { back?: number; lay?: number; backSize?: number; laySize?: number } | undefined>;
      const fair = fairOdds(runners);
      saveReferenceOdds(
        db,
        target.eventId,
        fair
          ? {
              fair,
              back: Object.fromEntries(OUTCOMES.map((o) => [o, runners[o]!.back!])) as Record<Outcome, number>,
              lay: Object.fromEntries(OUTCOMES.map((o) => [o, runners[o]!.lay!])) as Record<Outcome, number>,
              backSize: Object.fromEntries(OUTCOMES.map((o) => [o, runners[o]!.backSize])),
              laySize: Object.fromEntries(OUTCOMES.map((o) => [o, runners[o]!.laySize])),
              matched: market.matched,
            }
          : null,
        scrapedAt
      );
      if (fair) priced++;
    }

    read = recordPlayerPrices(db, players, markets, scrapedAt);
  }

  // The players' value bets and suspect prices of every match within 48 h,
  // the exchange's or not, and the cycle's totals.
  if (targets.length > 0) {
    const at = new Date().toISOString();
    const shown = recordPlayerSignals(
      db,
      targets.map((t) => t.eventId),
      {
        at,
        exchangeSince: new Date(now - (opts.oddsMaxAgeMs ?? DEFAULT_ODDS_MAX_AGE_MS)).toISOString(),
        marketsSince: new Date(now - (opts.marketsMaxAgeMs ?? DEFAULT_MARKETS_MAX_AGE_MS)).toISOString(),
      }
    );
    recordPlayerCycle(db, { ...read, ...shown }, at);
    console.log(
      `[reference:players] ${read.markets} of ${players.length} markets read in ${read.matches} matches, ${read.priced} of ${read.runners} players priced, ${read.shown} reliably; ${shown.valueBets} value bets, ${shown.layBets} above the lay, ${shown.suspects} suspect prices`
    );
  }
  console.log(
    `[reference] ${targets.length} matches within 48 h, ${placed.length} on the exchange (${found} found now, ${searches} searches), ${priced} with fair odds`
  );
}
