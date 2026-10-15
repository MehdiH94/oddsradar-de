import { DatabaseSync } from "node:sqlite";
import { getReferenceTargets, golfCompetitors, saveReferenceMarkets } from "../db/reference";
import { DEFAULT_MARKETS_MAX_AGE_MS, DEFAULT_ODDS_MAX_AGE_MS } from "../db/repository";
import { ExchangePlayerMarket, fetchEventPlayerMarkets, fetchExchangePrices, MarketPrices, searchEvents } from "./exchange";
import { golfPrices, parseGolfSearch, placeGolfTournament } from "./golf";
import { findPlayerMarkets, PlacedMatch, playerMarketsToPrice, recordPlayerPrices, recordPlayerSignals } from "./players";

// The reference for a golf tournament's winner (./golf.ts), after the other
// sports' in the worker's reference cycle: the exchange lists all its golf in
// one search, so every tournament starting within a week is placed in it and
// priced together, each cycle. The majors months away are left to the
// bookmakers: the exchange has a few players priced on both sides there.

const HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

export interface GolfReferenceOptions {
  // The exchange's search, as it answers (./exchange.ts, searchEvents).
  search?: (query: string, opts?: { size?: number }) => Promise<unknown>;
  prices?: (markets: { marketId: string; eventId: string }[]) => Promise<Map<string, MarketPrices>>;
  now?: Date;
  oddsMaxAgeMs?: number;
  marketsMaxAgeMs?: number;
  // A tournament's Top 5, 10 and 20 on the exchange (./exchange.ts,
  // fetchEventPlayerMarkets), and when each was last listed, across cycles.
  playerMarkets?: (exchangeEventId: string) => Promise<ExchangePlayerMarket[]>;
  playersCheckedAt?: Map<string, number>;
}

const playersListedAt = new Map<string, number>();

export async function runGolfReferenceCycle(db: DatabaseSync, opts: GolfReferenceOptions = {}): Promise<void> {
  const search = opts.search ?? searchEvents;
  const prices = opts.prices ?? ((markets) => fetchExchangePrices(markets));
  const now = (opts.now ?? new Date()).getTime();
  const oddsSince = new Date(now - (opts.oddsMaxAgeMs ?? DEFAULT_ODDS_MAX_AGE_MS)).toISOString();
  const targets = getReferenceTargets(db, {
    from: new Date(now).toISOString(),
    to: new Date(now + HORIZON_MS).toISOString(),
    oddsSince,
    sports: ["golf"],
  });
  if (targets.length === 0) return;

  const tournaments = parseGolfSearch(await search("Golf", { size: 50 }));
  const placed = targets.flatMap((target) => {
    const competitors = golfCompetitors(db, target.eventId, oddsSince);
    const tournament = placeGolfTournament({ participants: target.participants, startTime: target.startTime, competitors }, tournaments);
    return tournament ? [{ target, tournament, competitors }] : [];
  });
  // The Top 5, 10 and 20 of each, the players' markets of the pipeline the
  // scorers' are in (./players.ts): listed on the exchange every half hour,
  // priced with the winners in one read.
  const placedMatches: PlacedMatch[] = placed.map(({ target, tournament }) => ({ eventId: target.eventId, exchangeEventId: tournament.eventId }));
  await findPlayerMarkets(db, placedMatches, opts.playerMarkets ?? fetchEventPlayerMarkets, now, opts.playersCheckedAt ?? playersListedAt);
  const players = playerMarketsToPrice(db, placedMatches);

  const fair = new Set<string>();
  let read = { markets: 0, runners: 0, shown: 0 };
  if (placed.length > 0) {
    const markets = await prices([
      ...placed.map(({ tournament }) => ({ marketId: tournament.marketId, eventId: tournament.eventId })),
      ...players.map(({ match, market }) => ({ marketId: market.marketId, eventId: match.exchangeEventId })),
    ]);
    // The prices are as old as the end of their read.
    const scrapedAt = new Date().toISOString();
    for (const { target, tournament, competitors } of placed) {
      const rows = golfPrices(tournament, competitors, markets.get(tournament.marketId));
      // Not answered this time: its last prices stay, and age out.
      if (rows.length === 0) continue;
      saveReferenceMarkets(db, target.eventId, rows, scrapedAt);
      if (rows.some((r) => r.fair !== undefined)) fair.add(target.eventId);
    }
    read = recordPlayerPrices(db, players, markets, scrapedAt);
  }
  // Every Top N price above what a player is worth: a value bet from 5%
  // (src/db/playerValue.ts), the exchange's or not.
  const shown = recordPlayerSignals(
    db,
    targets.map((t) => t.eventId),
    {
      at: new Date().toISOString(),
      exchangeSince: oddsSince,
      marketsSince: new Date(now - (opts.marketsMaxAgeMs ?? DEFAULT_MARKETS_MAX_AGE_MS)).toISOString(),
    }
  );
  console.log(
    `[reference:golf] tournaments within 7 days / on the exchange / with fair odds: ${targets.length}/${placed.length}/${fair.size} (${tournaments.length} listed); ` +
      `Top N: ${read.markets} of ${players.length} markets read, ${read.shown} of ${read.runners} players with fair odds; ${shown.valueBets} value bets, ${shown.layBets} above the lay`
  );
}
