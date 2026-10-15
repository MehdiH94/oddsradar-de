import { DatabaseSync } from "node:sqlite";
import { Reliability } from "../reference/exchange";
import { PlayerBasis, PlayerSignal, SHOWN_BASES, SignalThresholds, SITE_THRESHOLDS } from "./playerValue";

// What the exchange's players' markets gave over time, to judge them by
// (GET /api/stats/players): how often each player was priced, and how often
// reliably; every bookmaker price found above what a player is worth
// (src/db/playerValue.ts); each cycle's totals. Kept after kick-off, unlike
// the prices themselves.

// The signals counted: lower than the dashboard's thresholds, so that the
// summary can tell what other ones would have given.
export const COUNTED_THRESHOLDS: SignalThresholds = { fair: 0.01, lay: 0.01, bookmaker: 0.1 };
// The edges the summary counts them at.
const EDGE_LEVELS: Record<PlayerBasis, number[]> = {
  fair: [0.01, 0.03, 0.05, 0.1, 0.2],
  lay: [0.01, 0.03, 0.05, 0.1, 0.2],
  bookmaker: [0.1, 0.2, 0.3, 0.5],
};

export interface RunnerRead {
  eventId: string;
  market: string;
  runner: string;
  player: string | null;
  reliability: Reliability;
  spread?: number;
  // The money on its thinner side.
  size: number;
  matched: number;
}

// One read of a runner's prices.
export function recordRunnerRead(db: DatabaseSync, read: RunnerRead, at: string): void {
  const { priced, loose, shown, spread, strict } = read.reliability;
  db.prepare(
    `INSERT INTO reference_player_stats
       (event_id, market, runner, player, reads, priced, loose, shown, spread, strict, best_spread, best_size, matched,
        first_seen_at, last_seen_at, first_strict_at, last_strict_at)
     VALUES (@eventId, @market, @runner, @player, 1, @priced, @loose, @shown, @spreadOk, @strict, @bestSpread, @size, @matched,
             @at, @at, @strictAt, @strictAt)
     ON CONFLICT(event_id, market, runner) DO UPDATE SET
       player = COALESCE(excluded.player, player),
       reads = reads + 1,
       priced = priced + excluded.priced,
       loose = loose + excluded.loose,
       shown = shown + excluded.shown,
       spread = spread + excluded.spread,
       strict = strict + excluded.strict,
       best_spread = CASE WHEN excluded.best_spread IS NULL THEN best_spread
                          WHEN best_spread IS NULL THEN excluded.best_spread
                          ELSE MIN(best_spread, excluded.best_spread) END,
       best_size = MAX(best_size, excluded.best_size),
       matched = MAX(matched, excluded.matched),
       last_seen_at = excluded.last_seen_at,
       first_strict_at = COALESCE(first_strict_at, excluded.first_strict_at),
       last_strict_at = COALESCE(excluded.last_strict_at, last_strict_at)`
  ).run({
    eventId: read.eventId,
    market: read.market,
    runner: read.runner,
    player: read.player,
    priced: Number(priced),
    loose: Number(loose),
    shown: Number(shown),
    spreadOk: Number(spread),
    strict: Number(strict),
    bestSpread: priced ? (read.spread ?? null) : null,
    size: priced ? read.size : 0,
    matched: read.matched,
    at,
    strictAt: strict ? at : null,
  });
}

// A bookmaker price found above what a player is worth this cycle (at
// COUNTED_THRESHOLDS).
export function recordSignal(db: DatabaseSync, eventId: string, market: string, signal: PlayerSignal, at: string): void {
  db.prepare(
    `INSERT INTO reference_player_signals
       (event_id, market, player, bookmaker, basis, cycles, best_edge, best_price, best_reference, reference_bookmaker,
        first_seen_at, last_seen_at)
     VALUES (@eventId, @market, @player, @bookmaker, @basis, 1, @edge, @price, @reference, @referenceBookmaker, @at, @at)
     ON CONFLICT(event_id, market, player, bookmaker, basis) DO UPDATE SET
       cycles = cycles + 1,
       best_price = CASE WHEN excluded.best_edge > best_edge THEN excluded.best_price ELSE best_price END,
       best_reference = CASE WHEN excluded.best_edge > best_edge THEN excluded.best_reference ELSE best_reference END,
       reference_bookmaker = CASE WHEN excluded.best_edge > best_edge THEN excluded.reference_bookmaker ELSE reference_bookmaker END,
       best_edge = MAX(best_edge, excluded.best_edge),
       last_seen_at = excluded.last_seen_at`
  ).run({
    eventId,
    market,
    player: signal.player,
    bookmaker: signal.bookmaker,
    basis: signal.basis,
    edge: signal.edge,
    price: signal.price,
    reference: signal.reference,
    referenceBookmaker: signal.referenceBookmaker ?? null,
    at,
  });
}

export interface PlayerCycle {
  // The exchange's: matches and markets read, their runners at each level.
  matches: number;
  markets: number;
  runners: number;
  priced: number;
  loose: number;
  shown: number;
  spread: number;
  strict: number;
  // Runners matched to a bookmaker's player.
  players: number;
  // What the dashboard shows this cycle (src/db/playerValue.ts): value bets
  // against the fair odds (those as tight as a 1X2's among them) and the
  // lay; and the suspect prices (30%), counted but not shown.
  valueBets: number;
  strictValueBets: number;
  layBets: number;
  suspects: number;
}

export function recordPlayerCycle(db: DatabaseSync, cycle: PlayerCycle, at: string): void {
  db.prepare(
    `INSERT OR REPLACE INTO reference_player_cycles
       (at, matches, markets, runners, priced, loose, shown, spread, strict, players, value_bets, strict_value_bets,
        lay_bets, suspects)
     VALUES (@at, @matches, @markets, @runners, @priced, @loose, @shown, @spread, @strict, @players, @valueBets,
             @strictValueBets, @layBets, @suspects)`
  ).run({ at, ...cycle });
}

// --- the summary ----------------------------------------------------------------

interface MatchInfo {
  eventId: string;
  participants: string[];
  competition: string;
  startTime: string;
}

type Levels = { priced: number; loose: number; shown: number; spread: number; strict: number };

export interface PlayerStatsSummary {
  since: string;
  cycles: number;
  // Distinct matches, markets and runners read, and those ever priced at each
  // level; and the reads at each level.
  totals: {
    matches: number;
    markets: number;
    runners: number;
    players: number;
    runnersEver: Levels;
    reads: Levels & { all: number };
  };
  // Distinct signals (match, market, player, bookmaker) by way, counted at
  // several edges: those at the dashboard's thresholds (5%, 5%, 30%) are the
  // ones it showed.
  signals: Record<PlayerBasis, Record<string, number>>;
  byCompetition: { competition: string; matches: number; runners: number; shownRunners: number; matched: number }[];
  matches: (MatchInfo & {
    markets: number;
    runners: number;
    shownRunners: number;
    shownReads: number;
    // Most matched on any of its players' markets, in euros.
    matched: number;
    // The signals the dashboard showed, by way.
    shownSignals: Record<PlayerBasis, number>;
  })[];
  // The signals, those the dashboard showed first, then by edge.
  list: (MatchInfo & {
    market: string;
    player: string;
    bookmaker: string;
    basis: PlayerBasis;
    cycles: number;
    bestEdge: number;
    bestPrice: number;
    bestReference: number;
    referenceBookmaker: string | null;
    firstSeenAt: string;
    lastSeenAt: string;
    shown: boolean;
  })[];
  // By hour: the most of each total seen in a cycle.
  hours: (PlayerCycle & { hour: string })[];
}

const MAX_LISTED = 200;
const BASES: PlayerBasis[] = ["fair", "lay", "bookmaker"];

// What the players' markets gave since `since` (an ISO time).
export function getPlayerStats(db: DatabaseSync, since: string): PlayerStatsSummary {
  const events = new Map<string, MatchInfo>();
  const infoOf = (eventId: string): MatchInfo => {
    let info = events.get(eventId);
    if (!info) {
      const row = db
        .prepare("SELECT participants, competition, start_time AS startTime FROM events WHERE id = @eventId")
        .get({ eventId }) as { participants: string; competition: string; startTime: string } | undefined;
      info = {
        eventId,
        participants: row ? JSON.parse(row.participants) : [],
        competition: row?.competition ?? "",
        startTime: row?.startTime ?? "",
      };
      events.set(eventId, info);
    }
    return info;
  };

  const stats = db
    .prepare(
      `SELECT event_id AS eventId, market, runner, player, reads, priced, loose, shown, spread, strict, matched
       FROM reference_player_stats WHERE last_seen_at >= @since`
    )
    .all({ since }) as unknown as (Levels & {
    eventId: string;
    market: string;
    runner: string;
    player: string | null;
    reads: number;
    matched: number;
  })[];
  const signals = db
    .prepare(
      `SELECT event_id AS eventId, market, player, bookmaker, basis, cycles, best_edge AS bestEdge, best_price AS bestPrice,
              best_reference AS bestReference, reference_bookmaker AS referenceBookmaker,
              first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt
       FROM reference_player_signals WHERE last_seen_at >= @since`
    )
    .all({ since }) as unknown as (Omit<PlayerStatsSummary["list"][number], keyof MatchInfo | "shown"> & { eventId: string })[];
  const cycles = db
    .prepare(
      `SELECT substr(at, 1, 13) AS hour, COUNT(*) AS n, MAX(matches) AS matches, MAX(markets) AS markets,
              MAX(runners) AS runners, MAX(priced) AS priced, MAX(loose) AS loose, MAX(shown) AS shown,
              MAX(spread) AS spread, MAX(strict) AS strict, MAX(players) AS players, MAX(value_bets) AS valueBets,
              MAX(strict_value_bets) AS strictValueBets, MAX(lay_bets) AS layBets, MAX(suspects) AS suspects
       FROM reference_player_cycles WHERE at >= @since GROUP BY hour ORDER BY hour`
    )
    .all({ since }) as unknown as (PlayerCycle & { hour: string; n: number })[];

  const isShown = (s: { basis: PlayerBasis; bestEdge: number }) =>
    SHOWN_BASES.includes(s.basis) && s.bestEdge >= SITE_THRESHOLDS[s.basis] - 1e-12;
  const levels = (count: (key: keyof Levels) => number): Levels => ({
    priced: count("priced"),
    loose: count("loose"),
    shown: count("shown"),
    spread: count("spread"),
    strict: count("strict"),
  });

  // By match: its markets' most matched amount, its runners and signals.
  const byMatch = new Map<string, PlayerStatsSummary["matches"][number]>();
  const markets = new Set<string>();
  const newMatch = (eventId: string): PlayerStatsSummary["matches"][number] => ({
    ...infoOf(eventId),
    markets: 0,
    runners: 0,
    shownRunners: 0,
    shownReads: 0,
    matched: 0,
    shownSignals: { fair: 0, lay: 0, bookmaker: 0 },
  });
  for (const s of stats) {
    const m = byMatch.get(s.eventId) ?? newMatch(s.eventId);
    m.runners++;
    if (s.shown > 0) m.shownRunners++;
    m.shownReads += s.shown;
    const key = `${s.eventId}|${s.market}`;
    if (!markets.has(key)) m.markets++;
    markets.add(key);
    m.matched = Math.max(m.matched, s.matched);
    byMatch.set(s.eventId, m);
  }
  // A suspect price can come from a match the exchange doesn't list.
  for (const s of signals) {
    const m = byMatch.get(s.eventId) ?? newMatch(s.eventId);
    if (isShown(s)) m.shownSignals[s.basis]++;
    byMatch.set(s.eventId, m);
  }
  const byCompetition = new Map<string, PlayerStatsSummary["byCompetition"][number]>();
  for (const m of byMatch.values()) {
    const c = byCompetition.get(m.competition) ?? { competition: m.competition, matches: 0, runners: 0, shownRunners: 0, matched: 0 };
    c.matches++;
    c.runners += m.runners;
    c.shownRunners += m.shownRunners;
    c.matched += m.matched;
    byCompetition.set(m.competition, c);
  }
  const shownCount = (m: PlayerStatsSummary["matches"][number]) => m.shownSignals.fair + m.shownSignals.lay + m.shownSignals.bookmaker;

  return {
    since,
    cycles: cycles.reduce((t, c) => t + c.n, 0),
    totals: {
      matches: new Set(stats.map((s) => s.eventId)).size,
      markets: markets.size,
      runners: stats.length,
      players: stats.filter((s) => s.player !== null).length,
      runnersEver: levels((key) => stats.filter((s) => s[key] > 0).length),
      reads: { all: stats.reduce((t, s) => t + s.reads, 0), ...levels((key) => stats.reduce((t, s) => t + s[key], 0)) },
    },
    signals: Object.fromEntries(
      BASES.map((basis) => [
        basis,
        Object.fromEntries(
          EDGE_LEVELS[basis].map((level) => [
            `${Math.round(level * 100)}%`,
            signals.filter((s) => s.basis === basis && s.bestEdge >= level - 1e-12).length,
          ])
        ),
      ])
    ) as PlayerStatsSummary["signals"],
    byCompetition: [...byCompetition.values()].sort((a, b) => b.shownRunners - a.shownRunners || b.matched - a.matched),
    matches: [...byMatch.values()]
      .sort((a, b) => shownCount(b) - shownCount(a) || b.shownRunners - a.shownRunners || b.matched - a.matched)
      .slice(0, MAX_LISTED),
    list: signals
      .map((s) => ({ ...infoOf(s.eventId), ...s, shown: isShown(s) }))
      .sort((a, b) => Number(b.shown) - Number(a.shown) || b.bestEdge - a.bestEdge)
      .slice(0, MAX_LISTED),
    hours: cycles.map(({ n: _n, ...c }) => c),
  };
}
