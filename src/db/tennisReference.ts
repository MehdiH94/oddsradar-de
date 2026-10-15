import { DatabaseSync } from "node:sqlite";
import { MARKET_1X2, MARKET_MATCH_WINNER } from "../scraper/canonical";
import { isMainTour } from "../markets/tennis";
import { TennisMarkets } from "../reference/tennis";
import { listedTheOtherWay } from "../reference/match";
import { isCompetitionEventSql } from "./competition";

// The tennis reference's storage (src/reference/tennisRun.ts): where the
// exchange lists each main-tour match, its markets there, and their prices.

export interface TennisSource {
  exchangeEventId: string;
  reversed: boolean;
  // Our players, in the order `reversed` is relative to.
  participants: string[];
  markets?: TennisMarkets;
  listedAt?: string;
}

export interface TennisTarget {
  eventId: string;
  participants: string[];
  source?: TennisSource;
}

// A source read back for our match as it lists its players now: `reversed`
// turned round, and kept so, if they are the other way round from when it
// was found (src/db/reference.ts, orientedSource).
function orientedTennisSource(db: DatabaseSync, eventId: string, source: TennisSource, participants: string[]): TennisSource {
  if (!listedTheOtherWay(source.participants, participants)) return source;
  const oriented = { ...source, reversed: !source.reversed, participants };
  db.prepare(
    `UPDATE reference_tennis_sources SET reversed = @reversed, participants = @participants WHERE event_id = @eventId`
  ).run({ eventId, reversed: oriented.reversed ? 1 : 0, participants: JSON.stringify(participants) });
  console.log(
    `[reference:tennis] ${eventId} now lists ${participants.join(" - ")}, found as ${source.participants.join(" - ")}: its exchange players swapped`
  );
  return oriented;
}

// The main tours' tennis matches starting in the window that a bookmaker
// still prices. A source found before its players' order was kept
// (6/10/2026) is left out: its match is searched again.
export function getTennisTargets(db: DatabaseSync, opts: { from: string; to: string; oddsSince: string }): TennisTarget[] {
  const rows = db
    .prepare(
      `SELECT e.id, e.competition, e.participants, t.exchange_event_id AS exchangeEventId, t.reversed, t.markets,
              t.listed_at AS listedAt, t.participants AS sourceParticipants
       FROM events e LEFT JOIN reference_tennis_sources t ON t.event_id = e.id
       WHERE e.sport = 'tennis' AND NOT ${isCompetitionEventSql("e")} AND e.start_time > @from AND e.start_time <= @to
         AND EXISTS (SELECT 1 FROM event_bookmaker_odds o WHERE o.event_id = e.id AND o.scraped_at >= @oddsSince)
       ORDER BY e.start_time ASC, e.id`
    )
    .all(opts) as unknown as {
    id: string;
    competition: string;
    participants: string;
    exchangeEventId: string | null;
    reversed: number | null;
    markets: string | null;
    listedAt: string | null;
    sourceParticipants: string | null;
  }[];
  return rows
    .filter((row) => isMainTour(row.competition))
    .map((row) => {
      const participants: string[] = JSON.parse(row.participants);
      const source =
        row.exchangeEventId && row.sourceParticipants
          ? orientedTennisSource(
              db,
              row.id,
              {
                exchangeEventId: row.exchangeEventId,
                reversed: row.reversed === 1,
                participants: JSON.parse(row.sourceParticipants),
                ...(row.markets ? { markets: JSON.parse(row.markets) } : {}),
                ...(row.listedAt ? { listedAt: row.listedAt } : {}),
              },
              participants
            )
          : undefined;
      return { eventId: row.id, participants, ...(source ? { source } : {}) };
    });
}

export function saveTennisSource(db: DatabaseSync, eventId: string, source: TennisSource, seenAt: string): void {
  db.prepare(
    `INSERT INTO reference_tennis_sources (event_id, exchange_event_id, reversed, participants, markets, listed_at, seen_at)
     VALUES (@eventId, @exchangeEventId, @reversed, @participants, @markets, @listedAt, @seenAt)
     ON CONFLICT(event_id) DO UPDATE SET
       exchange_event_id = excluded.exchange_event_id,
       reversed = excluded.reversed,
       participants = excluded.participants,
       markets = COALESCE(excluded.markets, markets),
       listed_at = COALESCE(excluded.listed_at, listed_at),
       seen_at = excluded.seen_at`
  ).run({
    eventId,
    exchangeEventId: source.exchangeEventId,
    reversed: source.reversed ? 1 : 0,
    participants: JSON.stringify(source.participants),
    markets: source.markets ? JSON.stringify(source.markets) : null,
    listedAt: source.listedAt ?? null,
    seenAt,
  });
}

export interface TennisReferencePrice {
  fair?: number;
  lay?: number;
  matched: number;
}

// The given matches' current tennis reference, but its winner (the listing's
// reference, loadReferences, like the other sports' 1X2): event -> market ->
// outcome.
export function loadTennisReference(
  db: DatabaseSync,
  eventIds: readonly string[],
  since: string
): Map<string, Map<string, Map<string, TennisReferencePrice>>> {
  const byEvent = new Map<string, Map<string, Map<string, TennisReferencePrice>>>();
  const select = db.prepare(
    `SELECT market, selection, fair, lay, matched FROM reference_markets
     WHERE event_id = @eventId AND scraped_at >= @since AND market NOT IN (@winner, @x12)`
  );
  for (const eventId of new Set(eventIds)) {
    const rows = select.all({ eventId, since, winner: MARKET_MATCH_WINNER, x12: MARKET_1X2 }) as {
      market: string;
      selection: string;
      fair: number | null;
      lay: number | null;
      matched: number;
    }[];
    if (rows.length === 0) continue;
    const byMarket = new Map<string, Map<string, TennisReferencePrice>>();
    for (const r of rows) {
      if (!byMarket.has(r.market)) byMarket.set(r.market, new Map());
      byMarket.get(r.market)!.set(r.selection, {
        ...(r.fair !== null ? { fair: r.fair } : {}),
        ...(r.lay !== null ? { lay: r.lay } : {}),
        matched: r.matched,
      });
    }
    byEvent.set(eventId, byMarket);
  }
  return byEvent;
}
