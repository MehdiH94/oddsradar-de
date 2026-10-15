import { DatabaseSync } from "node:sqlite";
import { alignCompetitors } from "../matcher/match";
import {
  bookmakerPlayers,
  loadBookmakerPlayerPrices,
  loadPlayerExchange,
  loadPlayerExchangeLevels,
  loadPlayerMarkets,
  PlayerOddsRow,
  savePlayerMarkets,
  savePlayerOdds,
} from "../db/playerReference";
import { COUNTED_THRESHOLDS, PlayerCycle, recordRunnerRead, recordSignal } from "../db/playerStats";
import { playerSignals, SITE_THRESHOLDS } from "../db/playerValue";
import { ExchangePlayerMarket, MarketPrices, midPrice, playerReliability, sizeOf, spreadOf } from "./exchange";

// The reference's players' markets (scorer, first scorer, 2 or 3 goals): the
// exchange lists them a day or two before kick-off, with real money on the
// big matches only. Every player's prices are read with the 1X2's
// (./run.ts); the fair odds of those reliable enough are shown, the
// bookmakers' prices above what a player is worth are found
// (src/db/playerValue.ts), and all of it is counted (src/db/playerStats.ts)
// to judge the markets by.

// A match's players' markets are looked for again this long after: the
// exchange adds them, and their players, as kick-off nears.
export const PLAYER_MARKETS_REFRESH_MS = 30 * 60 * 1000;
// Matches whose markets are listed per cycle.
const MAX_DETAILS_PER_CYCLE = 80;

// A match placed on the exchange: our id and its id there.
export interface PlacedMatch {
  eventId: string;
  exchangeEventId: string;
}

// Lists the players' markets of the matches not looked at for half an hour,
// and keeps them. A failed listing keeps the last ones.
export async function findPlayerMarkets(
  db: DatabaseSync,
  placed: readonly PlacedMatch[],
  fetchMarkets: (exchangeEventId: string) => Promise<ExchangePlayerMarket[]>,
  now: number,
  checkedAt: Map<string, number>
): Promise<number> {
  let asked = 0;
  for (const match of placed) {
    if (now - (checkedAt.get(match.eventId) ?? -Infinity) < PLAYER_MARKETS_REFRESH_MS) continue;
    if (asked >= MAX_DETAILS_PER_CYCLE) break;
    asked++;
    checkedAt.set(match.eventId, now);
    try {
      savePlayerMarkets(db, match.eventId, await fetchMarkets(match.exchangeEventId), new Date(now).toISOString());
    } catch (err) {
      console.error(`[reference:players] markets of ${match.exchangeEventId} failed:`, err);
    }
  }
  return asked;
}

// The players' markets to price this cycle, with the match each belongs to.
export function playerMarketsToPrice(
  db: DatabaseSync,
  placed: readonly PlacedMatch[]
): { match: PlacedMatch; market: ExchangePlayerMarket }[] {
  const byEvent = loadPlayerMarkets(
    db,
    placed.map((m) => m.eventId)
  );
  return placed.flatMap((match) => (byEvent.get(match.eventId) ?? []).map((market) => ({ match, market })));
}

// The exchange's side of a cycle's totals (src/db/playerStats.ts).
export type ExchangeReadTotals = Pick<
  PlayerCycle,
  "matches" | "markets" | "runners" | "priced" | "loose" | "shown" | "spread" | "strict" | "players"
>;

// Saves this read of the players' markets, and counts it: each runner's
// prices and reliability, its fair odds when reliable enough to show. A
// market the exchange didn't answer keeps its last prices, which age out,
// and isn't counted.
export function recordPlayerPrices(
  db: DatabaseSync,
  priced: readonly { match: PlacedMatch; market: ExchangePlayerMarket }[],
  prices: ReadonlyMap<string, MarketPrices>,
  scrapedAt: string
): ExchangeReadTotals {
  const totals: ExchangeReadTotals = { matches: 0, markets: 0, runners: 0, priced: 0, loose: 0, shown: 0, spread: 0, strict: 0, players: 0 };
  const answered = priced.filter(({ market }) => prices.has(market.marketId));
  for (const eventId of new Set(answered.map(({ match }) => match.eventId))) {
    // The exchange's names, aligned on the bookmakers' ("Ousmane Dembele" ->
    // "Ousmane Dembélé").
    const ours = bookmakerPlayers(db, eventId);
    const markets = answered.filter(({ match }) => match.eventId === eventId).map(({ market }) => market);
    const names = alignCompetitors([...new Set(markets.flatMap((m) => Object.values(m.runners)))], ours);
    totals.matches++;

    db.exec("BEGIN");
    try {
      for (const market of markets) {
        const read = prices.get(market.marketId)!;
        totals.markets++;
        const rows: PlayerOddsRow[] = [];
        for (const [id, runner] of Object.entries(market.runners)) {
          const runnerPrices = read.runners.get(Number(id)) ?? {};
          const reliability = playerReliability(runnerPrices);
          const mid = midPrice(runnerPrices);
          const player = names.get(runner) ?? null;
          rows.push({ runner, player, ...runnerPrices, fair: reliability.shown && mid !== undefined ? mid : null });
          recordRunnerRead(
            db,
            {
              eventId,
              market: market.market,
              runner,
              player,
              reliability,
              spread: spreadOf(runnerPrices),
              size: sizeOf(runnerPrices),
              matched: read.matched,
            },
            scrapedAt
          );
          totals.runners++;
          if (player) totals.players++;
          for (const level of ["priced", "loose", "shown", "spread", "strict"] as const) if (reliability[level]) totals[level]++;
        }
        savePlayerOdds(db, eventId, market.market, rows, read.matched, scrapedAt);
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
  return totals;
}

// What the dashboard shows of the players' markets this cycle, and what it
// counts (at lower thresholds): every bookmaker price above what a player is
// worth, in the matches given -- those the exchange doesn't list too, whose
// bookmakers are compared to each other (src/db/playerValue.ts).
export function recordPlayerSignals(
  db: DatabaseSync,
  eventIds: readonly string[],
  opts: { at: string; exchangeSince: string; marketsSince: string }
): Pick<PlayerCycle, "valueBets" | "strictValueBets" | "layBets" | "suspects"> {
  const shown = { valueBets: 0, strictValueBets: 0, layBets: 0, suspects: 0 };
  const exchange = loadPlayerExchange(db, eventIds, opts.exchangeSince);
  const bookmakers = loadBookmakerPlayerPrices(db, eventIds, opts.marketsSince);
  // As tight as a 1X2's: which of the value bets against the fair odds are.
  const strict = strictPlayers(db, eventIds, opts.exchangeSince);
  for (const [eventId, byMarket] of bookmakers) {
    db.exec("BEGIN");
    try {
      for (const [market, prices] of byMarket) {
        const known = exchange.get(eventId)?.get(market) ?? new Map();
        for (const signal of playerSignals(known, prices, COUNTED_THRESHOLDS)) {
          recordSignal(db, eventId, market, signal, opts.at);
          if (signal.edge < SITE_THRESHOLDS[signal.basis] - 1e-12) continue;
          if (signal.basis === "fair") {
            shown.valueBets++;
            if (strict.has(`${eventId}|${market}|${signal.player}`)) shown.strictValueBets++;
          } else if (signal.basis === "lay") shown.layBets++;
          else shown.suspects++;
        }
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
  return shown;
}

// The players whose current exchange prices are as tight as a 1X2's (10%,
// 20 EUR), as "event|market|player".
function strictPlayers(db: DatabaseSync, eventIds: readonly string[], since: string): Set<string> {
  const strict = new Set<string>();
  for (const [eventId, byMarket] of loadPlayerExchangeLevels(db, eventIds, since)) {
    for (const [market, players] of byMarket) for (const player of players) strict.add(`${eventId}|${market}|${player}`);
  }
  return strict;
}
