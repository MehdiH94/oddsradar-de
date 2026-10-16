import { DatabaseSync } from "node:sqlite";
import { Outcome } from "../reference/exchange";
import { ReferenceMarketRow } from "../reference/sports";
import { MARKET_1X2, MARKET_MATCH_WINNER, MARKET_OUTRIGHT } from "../scraper/canonical";
import { listedTheOtherWay } from "../reference/match";
import { OUTRIGHT_VALUE_MIN_EDGE } from "./value";
import { isCompetitionEventSql } from "./competition";

// The reference's storage (src/reference/): where the exchange lists each
// match, and its fair odds. Apart from the bookmakers' tables, so that no
// best price, TRJ or event is ever made of it.

const OUTCOMES: Outcome[] = ["1", "X", "2"];

export interface ReferenceSource {
  exchangeEventId: string;
  marketId: string;
  // The exchange's runner of each outcome: "1", "X", "2" (a winner's "1", "2").
  selections: Record<string, number>;
  // Our participants, in the order the selections' "1" and "2" stand for.
  participants: string[];
}

// A source read back for our match as it lists its participants now: its "1"
// and "2" swapped, and kept so, if they are the other way round from when it
// was found.
function orientedSource(db: DatabaseSync, eventId: string, source: ReferenceSource, participants: string[]): ReferenceSource {
  if (!listedTheOtherWay(source.participants, participants)) return source;
  const { "1": one, "2": two, ...rest } = source.selections;
  const oriented = { ...source, selections: { ...rest, "1": two, "2": one }, participants };
  db.prepare(`UPDATE reference_sources SET selections = @selections, participants = @participants WHERE event_id = @eventId`).run({
    eventId,
    selections: JSON.stringify(oriented.selections),
    participants: JSON.stringify(participants),
  });
  console.log(
    `[reference] ${eventId} now lists ${participants.join(" - ")}, found as ${source.participants.join(" - ")}: its exchange runners swapped`
  );
  return oriented;
}

// A match the reference cycle prices: where the exchange lists it, once found.
export interface ReferenceTargetRow {
  eventId: string;
  sport: string;
  participants: string[];
  startTime: string;
  source?: ReferenceSource;
}

// The matches of these sports (football's by default) starting in the window
// that a bookmaker still prices, soonest first. A source found before its
// participants' order was kept (6/10/2026) is left out: its match is searched
// again.
export function getReferenceTargets(
  db: DatabaseSync,
  opts: { from: string; to: string; oddsSince: string; sports?: readonly string[] }
): ReferenceTargetRow[] {
  const sports = opts.sports ?? ["football"];
  const params: Record<string, string> = { from: opts.from, to: opts.to, oddsSince: opts.oddsSince };
  const placeholders = sports.map((sport, i) => {
    params[`sport${i}`] = sport;
    return `@sport${i}`;
  });
  if (placeholders.length === 0) return [];
  const rows = db
    .prepare(
      `SELECT e.id, e.sport, e.participants, e.start_time AS startTime,
              r.exchange_event_id AS exchangeEventId, r.market_id AS marketId, r.selections,
              r.participants AS sourceParticipants
       FROM events e LEFT JOIN reference_sources r ON r.event_id = e.id
       WHERE e.sport IN (${placeholders.join(", ")}) AND NOT ${isCompetitionEventSql("e")}
         AND e.start_time > @from AND e.start_time <= @to
         AND EXISTS (SELECT 1 FROM event_bookmaker_odds o WHERE o.event_id = e.id AND o.scraped_at >= @oddsSince)
       ORDER BY e.start_time ASC, e.id`
    )
    .all(params) as unknown as {
    id: string;
    sport: string;
    participants: string;
    startTime: string;
    exchangeEventId: string | null;
    marketId: string | null;
    selections: string | null;
    sourceParticipants: string | null;
  }[];
  return rows.map((row) => {
    const participants: string[] = JSON.parse(row.participants);
    const source =
      row.exchangeEventId && row.marketId && row.selections && row.sourceParticipants
        ? orientedSource(
            db,
            row.id,
            {
              exchangeEventId: row.exchangeEventId,
              marketId: row.marketId,
              selections: JSON.parse(row.selections),
              participants: JSON.parse(row.sourceParticipants),
            },
            participants
          )
        : undefined;
    return { eventId: row.id, sport: row.sport, participants, startTime: row.startTime, ...(source ? { source } : {}) };
  });
}

// A golf tournament's players as the bookmakers name them now, the seed
// bookmakers' spelling first (src/matcher/match.ts): the exchange's names take
// it, so that its prices land on the row the bookmakers' are on.
export function golfCompetitors(db: DatabaseSync, eventId: string, oddsSince: string): string[] {
  const rows = db
    .prepare(
      `SELECT selection FROM event_bookmaker_odds
       WHERE event_id = @eventId AND market = @market AND scraped_at >= @oddsSince
       ORDER BY CASE bookmaker_id WHEN 'leovegas' THEN 0 WHEN 'merkurbets' THEN 1 WHEN 'twentybet' THEN 2 WHEN 'betclic' THEN 3 WHEN 'winamax' THEN 4 ELSE 5 END, selection`
    )
    .all({ eventId, market: MARKET_OUTRIGHT, oddsSince }) as { selection: string }[];
  return [...new Set(rows.map((r) => r.selection))];
}

// The markets of these families, with their line ("spread|-6.5"), that a
// bookmaker's markets cycle lists for the match: the lines worth pricing on the
// exchange, which lists far more than a bookmaker does.
export function listedLines(db: DatabaseSync, eventId: string, families: readonly string[]): Set<string> {
  const rows = db
    .prepare("SELECT DISTINCT market FROM event_market_odds WHERE event_id = @eventId AND instr(market, '|') > 0")
    .all({ eventId }) as { market: string }[];
  return new Set(rows.map((r) => r.market).filter((market) => families.includes(market.slice(0, market.indexOf("|")))));
}

export function saveReferenceSource(db: DatabaseSync, eventId: string, source: ReferenceSource, seenAt: string): void {
  db.prepare(
    `INSERT INTO reference_sources (event_id, exchange_event_id, market_id, selections, participants, seen_at)
     VALUES (@eventId, @exchangeEventId, @marketId, @selections, @participants, @seenAt)
     ON CONFLICT(event_id) DO UPDATE SET
       exchange_event_id = excluded.exchange_event_id,
       market_id = excluded.market_id,
       selections = excluded.selections,
       participants = excluded.participants,
       seen_at = excluded.seen_at`
  ).run({
    eventId,
    exchangeEventId: source.exchangeEventId,
    marketId: source.marketId,
    selections: JSON.stringify(source.selections),
    participants: JSON.stringify(source.participants),
    seenAt,
  });
}

export interface ReferenceOdds {
  fair: Record<Outcome, number>;
  back: Record<Outcome, number>;
  lay: Record<Outcome, number>;
  // The money offered at them, in euros.
  backSize?: Partial<Record<Outcome, number>>;
  laySize?: Partial<Record<Outcome, number>>;
  matched: number;
}

// A match's reference prices, replacing the previous ones. Null when this
// read gave none (too few bettors on the market): the old ones go at once
// rather than being shown until they age out.
export function saveReferenceOdds(db: DatabaseSync, eventId: string, odds: ReferenceOdds | null, scrapedAt: string): void {
  const insert = db.prepare(
    `INSERT INTO reference_odds (event_id, selection, fair, back, lay, back_size, lay_size, matched, scraped_at)
     VALUES (@eventId, @selection, @fair, @back, @lay, @backSize, @laySize, @matched, @scrapedAt)`
  );
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM reference_odds WHERE event_id = @eventId").run({ eventId });
    if (odds) {
      for (const selection of OUTCOMES) {
        insert.run({
          eventId,
          selection,
          fair: odds.fair[selection],
          back: odds.back[selection],
          lay: odds.lay[selection],
          backSize: odds.backSize?.[selection] ?? null,
          laySize: odds.laySize?.[selection] ?? null,
          matched: odds.matched,
          scrapedAt,
        });
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// A match's prices in reference_markets (a tennis match's every market, an
// other sport's main one), replacing the previous ones.
export function saveReferenceMarkets(
  db: DatabaseSync,
  eventId: string,
  rows: readonly ReferenceMarketRow[],
  scrapedAt: string
): void {
  const insert = db.prepare(
    `INSERT OR REPLACE INTO reference_markets
       (event_id, market, selection, fair, back, lay, back_size, lay_size, matched, scraped_at)
     VALUES (@eventId, @market, @selection, @fair, @back, @lay, @backSize, @laySize, @matched, @scrapedAt)`
  );
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM reference_markets WHERE event_id = @eventId").run({ eventId });
    for (const r of rows) {
      insert.run({
        eventId,
        market: r.market,
        selection: r.selection,
        fair: r.fair ?? null,
        back: r.back ?? null,
        lay: r.lay ?? null,
        backSize: r.backSize ?? null,
        laySize: r.laySize ?? null,
        matched: r.matched,
        scrapedAt,
      });
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// What the dashboard shows of the reference: the fair odds of a match's main
// market, a 1X2's ("1", "X", "2": football, ice hockey, rugby) or a winner's
// ("1", "2": tennis, basketball... src/reference/tennisRun.ts, sportsRun.ts).
export interface Reference {
  // The market they price: MARKET_1X2, MARKET_MATCH_WINNER or, for a golf
  // tournament, MARKET_OUTRIGHT (its fair odds by player, those of the
  // players whose prices are tight enough). Only a bookmaker's prices of that
  // same market are compared to them.
  market: string;
  fair: Record<string, number>;
  matched: number;
  scrapedAt: string;
  // The edge from which a price is a value bet, when it is not VALUE_MIN_EDGE's.
  minEdge?: number;
}

// The given events' current reference, if any.
export function loadReferences(db: DatabaseSync, ids: readonly string[], since: string): Map<string, Reference> {
  const references = new Map<string, Reference>();
  // SQLite caps a statement's parameters: chunked, like countMarkets.
  for (let start = 0; start < ids.length; start += 500) {
    const params: Record<string, string> = { since };
    const placeholders = ids.slice(start, start + 500).map((id, i) => {
      params[`id${i}`] = id;
      return `@id${i}`;
    });
    const rows = db
      .prepare(
        `SELECT event_id AS eventId, selection, fair, matched, scraped_at AS scrapedAt FROM reference_odds
         WHERE event_id IN (${placeholders.join(", ")}) AND scraped_at >= @since`
      )
      .all(params) as unknown as { eventId: string; selection: Outcome; fair: number; matched: number; scrapedAt: string }[];
    const partial = new Map<string, { fair: Partial<Record<Outcome, number>>; matched: number; scrapedAt: string }>();
    for (const row of rows) {
      const entry = partial.get(row.eventId) ?? { fair: {}, matched: row.matched, scrapedAt: row.scrapedAt };
      entry.fair[row.selection] = row.fair;
      partial.set(row.eventId, entry);
    }
    for (const [eventId, entry] of partial) {
      if (OUTCOMES.every((o) => entry.fair[o] !== undefined)) {
        references.set(eventId, { ...entry, market: MARKET_1X2, fair: entry.fair as Record<Outcome, number> });
      }
    }
    // The other sports' main market: a tennis or basketball winner, an ice
    // hockey 1X2...
    const mains = db
      .prepare(
        `SELECT event_id AS eventId, market, selection, fair, matched, scraped_at AS scrapedAt FROM reference_markets
         WHERE event_id IN (${placeholders.join(", ")}) AND scraped_at >= @since AND market IN (@winner, @x12, @outright)
           AND fair IS NOT NULL`
      )
      .all({ ...params, winner: MARKET_MATCH_WINNER, x12: MARKET_1X2, outright: MARKET_OUTRIGHT }) as unknown as {
      eventId: string;
      market: string;
      selection: string;
      fair: number;
      matched: number;
      scrapedAt: string;
    }[];
    const others = new Map<string, Reference>();
    for (const row of mains) {
      const entry = others.get(row.eventId) ?? { market: row.market, fair: {}, matched: row.matched, scrapedAt: row.scrapedAt };
      entry.fair[row.selection] = row.fair;
      others.set(row.eventId, entry);
    }
    for (const [eventId, entry] of others) {
      // A golf tournament's players are as many as it has: any with fair odds
      // is a reference, and its value bets are weighed from OUTRIGHT_VALUE_MIN_EDGE.
      if (entry.market === MARKET_OUTRIGHT) references.set(eventId, { ...entry, minEdge: OUTRIGHT_VALUE_MIN_EDGE });
      else if ((entry.market === MARKET_1X2 ? OUTCOMES : ["1", "2"]).every((o) => entry.fair[o] !== undefined)) {
        references.set(eventId, entry);
      }
    }
  }
  return references;
}
