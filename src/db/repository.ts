import { DatabaseSync } from "node:sqlite";
import { CanonicalEvent, EventSource, EventWithOdds, RawOdds } from "../types";
import { normalizeName } from "../matcher/normalize";
import { keepsSidesOrder } from "../matcher/match";
import { marketLabel, outcomeLabel, parseMarketKey, PLAYER_FAMILIES } from "../markets/catalog";
import { payoutRate } from "./payoutRate";
import { Grid, payoutRateOf } from "./marketGrid";
import { loadReferences, Reference } from "./reference";
import { bestValue, Value, valueBetsOf } from "./value";
import { loadBookmakerPlayerPrices, loadPlayerExchange } from "./playerReference";
import { PLAYER_MARKET_KEYS, PlayerBasis, siteSignals } from "./playerValue";
import { MARKET_1X2, MARKET_MATCH_WINNER, MARKET_OUTRIGHT } from "../scraper/canonical";
import { competitionKey, competitionName, isCompetitionEventSql } from "./competition";
import { loadTennisReference } from "./tennisReference";
import { tennisSignals } from "./tennisValue";


const INSERT_ODDS = `
  INSERT INTO event_bookmaker_odds (event_id, bookmaker_id, market, selection, price, scraped_at)
  VALUES (@eventId, @bookmakerId, @market, @selection, @price, @scrapedAt)
  ON CONFLICT(event_id, bookmaker_id, market, selection) DO UPDATE SET
    price = excluded.price,
    scraped_at = excluded.scraped_at
`;

// How far back a stored event is still looked up to keep its id: a match is
// listed until it starts, a day is more than enough.
const STORED_ID_LOOKBACK_MS = 24 * 60 * 60 * 1000;

// The id of an event is the hash of the names of the bookmaker that seeds it
// (matchEvents): the first seed bookmaker's that lists it (LeoVegas.de's, then
// Betway.de's...), else the first to list it. A cycle where the seed leaves a match out, or lists it late, gives the same match
// another id, and with it another alert on Discord (an alert is sent once per
// id) and another line on the dashboard until the first goes stale. A
// bookmaker's own id for the match tells it is the same one, so an event that
// shares one with a stored event takes that event's id: the lowest, when it
// shares with several, so that a match already stored twice settles on one
// whichever bookmaker seeds it. Not when the stored sides come the other way
// round (its prices are "1" and "2" of that order), nor when the id is one
// that another event of the cycle takes.
function withStoredIds(db: DatabaseSync, events: CanonicalEvent[]): CanonicalEvent[] {
  if (!events.some((e) => e.sources && Object.keys(e.sources).length > 0)) return events;
  const stored = db
    .prepare(
      `SELECT s.bookmaker_id AS bookmakerId, s.source_id AS sourceId, e.id, e.sport, e.participants
       FROM event_sources s JOIN events e ON e.id = s.event_id
       WHERE e.start_time >= ?`
    )
    .all(new Date(Date.now() - STORED_ID_LOOKBACK_MS).toISOString()) as {
    bookmakerId: string;
    sourceId: string;
    id: string;
    sport: string;
    participants: string;
  }[];
  const bySource = new Map<string, typeof stored>();
  for (const row of stored) {
    const key = `${row.bookmakerId}\0${row.sourceId}`;
    bySource.set(key, [...(bySource.get(key) ?? []), row]);
  }

  const ownIds = new Set(events.map((e) => e.id));
  const taken = new Set<string>();
  return events.map((event) => {
    const candidates = Object.entries(event.sources ?? {})
      .flatMap(([bookmakerId, source]) => bySource.get(`${bookmakerId}\0${source.sourceId}`) ?? [])
      .filter((row) => row.sport === event.sport && keepsSidesOrder(JSON.parse(row.participants), event.participants))
      .map((row) => row.id);
    if (candidates.length === 0) return event;
    const id = candidates.reduce((lowest, candidate) => (candidate < lowest ? candidate : lowest));
    if (id === event.id || ownIds.has(id) || taken.has(id)) return event;
    taken.add(id);
    return { ...event, id };
  });
}

export function upsertCanonicalEvents(db: DatabaseSync, canonicalEvents: CanonicalEvent[]): void {
  const events = withStoredIds(db, canonicalEvents);
  const insertEvent = db.prepare(`
    INSERT INTO events (id, sport, competition, start_time, participants)
    VALUES (@id, @sport, @competition, @startTime, @participants)
    ON CONFLICT(id) DO UPDATE SET
      sport = excluded.sport,
      competition = excluded.competition,
      start_time = excluded.start_time,
      participants = excluded.participants
  `);
  const insertBookmaker = db.prepare(`
    INSERT INTO bookmakers (id, name) VALUES (@id, @name)
    ON CONFLICT(id) DO NOTHING
  `);
  const insertOdds = db.prepare(INSERT_ODDS);
  const insertSource = db.prepare(`
    INSERT INTO event_sources (event_id, bookmaker_id, source_id, participants, seen_at)
    VALUES (@eventId, @bookmakerId, @sourceId, @participants, @seenAt)
    ON CONFLICT(event_id, bookmaker_id) DO UPDATE SET
      source_id = excluded.source_id,
      participants = excluded.participants,
      seen_at = excluded.seen_at
  `);

  const scrapedAt = new Date().toISOString();

  db.exec("BEGIN");
  try {
    for (const event of events) {
      insertEvent.run({
        id: event.id,
        sport: event.sport,
        competition: event.competition,
        startTime: event.startTime,
        participants: JSON.stringify(event.participants),
      });
      for (const [bookmakerId, odds] of Object.entries(event.byBookmaker)) {
        insertBookmaker.run({ id: bookmakerId, name: bookmakerId });
        for (const o of odds) {
          insertOdds.run({
            eventId: event.id,
            bookmakerId,
            market: o.market,
            selection: o.selection,
            price: o.price,
            scrapedAt,
          });
        }
      }
      for (const [bookmakerId, source] of Object.entries(event.sources ?? {})) {
        insertSource.run({
          eventId: event.id,
          bookmakerId,
          sourceId: source.sourceId,
          participants: JSON.stringify(source.participants),
          seenAt: scrapedAt,
        });
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

interface OddsRow {
  id: string;
  sport: string;
  competition: string;
  startTime: string;
  participants: string;
  bookmakerId: string;
  market: string;
  selection: string;
  price: number;
  scrapedAt: string;
}

// Only pre-match odds are compared: a match drops off the dashboard at its
// start time, when bookmakers switch it to live betting. Events are never
// deleted, so this also keeps finished matches out. (It used to keep a match
// listed for three hours after kick-off, live odds included.)
//
// The cutoff is computed here and bound as a parameter rather than written as
// SQLite's datetime('now'). That built-in renders "YYYY-MM-DD HH:MM:SS" (space
// separator, no trailing Z) while start_time holds JavaScript toISOString()
// output ("YYYY-MM-DDTHH:MM:SS.sssZ"), and start_time is a TEXT column, so the
// comparison is a lexicographic string comparison between the two formats.
// 'T' (0x54) sorts after ' ' (0x20), so any event on the same calendar date
// compares greater regardless of its actual time -- verified: a match that
// started 10 hours ago was still returned. Binding an ISO string compares like
// against like.
//
// Shared by every query that lists events or derives values from them, so the
// sport <select> never offers a sport that /api/events would show nothing for.
export function notStartedCutoff(): string {
  return new Date().toISOString();
}

// Odds a bookmaker has stopped listing -- a withdrawn or suspended match, or a
// match the matcher now files under another event id -- are never deleted:
// their rows just stop being refreshed. Without this cutoff they stayed on
// the dashboard, frozen, until kick-off. Odds count as
// current for three scrape cycles, so a sport that misses one cycle (the
// scrapers skip a sport that fails to answer, see fetchWinamaxSnapshot and
// fetchAllBetclicSports) doesn't flicker off the dashboard.
const CYCLES_BEFORE_ODDS_EXPIRE = 3;
const DEFAULT_POLL_INTERVAL_MINUTES = 5;

// For the API process, which reads the worker's POLL_INTERVAL_MINUTES from the
// same .env. A missing or unusable value falls back to the worker's default,
// rather than an Invalid Date that would make every query throw.
export function oddsMaxAgeForPollInterval(pollIntervalMinutes: number): number {
  const minutes =
    Number.isFinite(pollIntervalMinutes) && pollIntervalMinutes > 0
      ? pollIntervalMinutes
      : DEFAULT_POLL_INTERVAL_MINUTES;
  return CYCLES_BEFORE_ODDS_EXPIRE * minutes * 60 * 1000;
}

export const DEFAULT_ODDS_MAX_AGE_MS = oddsMaxAgeForPollInterval(DEFAULT_POLL_INTERVAL_MINUTES);

// The same three cycles for the markets cycle's prices, refreshed every
// MARKETS_INTERVAL_MINUTES (15 by default, so 45 minutes).
const DEFAULT_MARKETS_INTERVAL_MINUTES = 15;

export function marketsMaxAgeForInterval(marketsIntervalMinutes: number): number {
  const minutes =
    Number.isFinite(marketsIntervalMinutes) && marketsIntervalMinutes > 0
      ? marketsIntervalMinutes
      : DEFAULT_MARKETS_INTERVAL_MINUTES;
  return CYCLES_BEFORE_ODDS_EXPIRE * minutes * 60 * 1000;
}

export const DEFAULT_MARKETS_MAX_AGE_MS = marketsMaxAgeForInterval(DEFAULT_MARKETS_INTERVAL_MINUTES);

export interface ListingOptions {
  oddsMaxAgeMs?: number;
  marketsMaxAgeMs?: number;
}

// scraped_at holds toISOString() output, so a bound ISO string compares like
// against like (see notStartedCutoff).
export function oddsCutoff(opts: ListingOptions): string {
  return new Date(Date.now() - (opts.oddsMaxAgeMs ?? DEFAULT_ODDS_MAX_AGE_MS)).toISOString();
}

export function marketsCutoff(opts: ListingOptions): string {
  return new Date(Date.now() - (opts.marketsMaxAgeMs ?? DEFAULT_MARKETS_MAX_AGE_MS)).toISOString();
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
// OFFSET is (page - 1) * pageSize, bound as a SQLite integer; an unbounded page
// (e.g. ?page=1e18) overflows that and the bind throws, which Express turns
// into a 500 with a stack trace. With pageSize capped at 100, a million pages
// keeps OFFSET under 1e8 -- far inside both SQLite's 64-bit range and JS's
// safe-integer range -- while being orders of magnitude past any real last
// page (a few thousand fresh events at most). Past the real last page the
// result is simply empty, with the real total.
const MAX_PAGE = 1_000_000;

// Floors first, then validates, so a fractional value like 0.5 falls back to
// the default instead of flooring to 0. NaN (a non-numeric query string) and
// anything below 1 fall back too; +Infinity clamps to the max.
function clampPositiveInt(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || Number.isNaN(value)) return fallback;
  const n = Math.floor(value);
  if (n < 1) return fallback;
  return Math.min(n, max);
}

export interface ListedEvent extends EventWithOdds {
  // TRJ of the match's best prices among the requested bookmakers, see
  // payoutRate. Null when an outcome has no price among them.
  payoutRate: number | null;
  // Its markets with a current price, the main one included: what its page
  // (/api/events/:id) shows.
  marketCount: number;
  // The reference's current fair odds for its 1X2 (src/db/reference.ts).
  reference: Reference | null;
  // Its best price against them among the requested bookmakers, value bet or
  // not (src/db/value.ts). Null without a reference.
  value: Value | null;
}

export interface EventsPage {
  events: ListedEvent[];
  total: number;
  page: number;
  pageSize: number;
}

// "start": soonest kick-off first. "trj": highest TRJ first, matches without
// one last, ties by kick-off. "value": best edge over the reference first,
// then the matches without a reference by TRJ.
export type EventSort = "start" | "trj" | "value";

// Only the matches with a current price in a players' market (a scorer, an
// assister...), at one of `bookmakers` when given.
interface PlayersFilter {
  marketsSince: string;
  bookmakers?: readonly string[];
}

// What else narrows the matches: players' markets (the listing's filter), a
// current reference or players' prices to weigh (the value bets',
// getValueBets).
interface ListingFilters {
  // Which events: the matches (the default; a competition's winner is not
  // counted among a sport's matches, nor compared as surebets), the winners of
  // the competitions alone (src/db/competition.ts), or "all" of them, the
  // matches' list with the winners beside them.
  kind?: "competition" | "all";
  // Only one competition's events, its matches and its winner (the name as
  // competitionName gives it, compared without the case or the accents).
  competition?: string;
  players?: PlayersFilter;
  valueSources?: { referenceSince: string; marketsSince: string };
  // Only the matches that start before this time (an ISO string): the
  // Freebets page looks a week ahead.
  startBefore?: string;
}

// A market key's family: "scorer_goals|2" -> "scorer_goals".
const MARKET_FAMILY_SQL = "CASE WHEN instr(m.market, '|') > 0 THEN substr(m.market, 1, instr(m.market, '|') - 1) ELSE m.market END";

// Events not started yet that still have at least one current price: one whose
// every bookmaker has stopped listing it must not be counted in the totals or
// offered as a sport or a suggestion, since it has nothing left to show.
function freshEventsFilter(
  sport: string | undefined,
  oddsSince: string,
  { kind, players, valueSources, startBefore }: ListingFilters = {}
): { whereClause: string; params: Record<string, string> } {
  const conditions = [
    "start_time > @now",
    "EXISTS (SELECT 1 FROM event_bookmaker_odds o WHERE o.event_id = events.id AND o.scraped_at >= @oddsSince)",
    ...(kind === "all" ? [] : [kind === "competition" ? isCompetitionEventSql() : `NOT ${isCompetitionEventSql()}`]),
  ];
  const params: Record<string, string> = { now: notStartedCutoff(), oddsSince };
  if (startBefore) {
    conditions.push("start_time <= @startBefore");
    params.startBefore = startBefore;
  }
  if (sport) {
    conditions.push("sport = @sport");
    params.sport = sport;
  }
  if (players) {
    const families = PLAYER_FAMILIES.map((family, i) => {
      params[`family${i}`] = family;
      return `@family${i}`;
    });
    const bookmakers = (players.bookmakers ?? []).map((bookmaker, i) => {
      params[`playersBookmaker${i}`] = bookmaker;
      return `@playersBookmaker${i}`;
    });
    params.marketsSince = players.marketsSince;
    conditions.push(
      `EXISTS (SELECT 1 FROM event_market_odds m WHERE m.event_id = events.id AND m.scraped_at >= @marketsSince
         AND ${MARKET_FAMILY_SQL} IN (${families.join(", ")})
         ${players.bookmakers ? `AND m.bookmaker_id IN (${bookmakers.join(", ") || "NULL"})` : ""})`
    );
  }
  if (valueSources) {
    params.referenceSince = valueSources.referenceSince;
    params.valueMarketsSince = valueSources.marketsSince;
    const playerMarkets = PLAYER_MARKET_KEYS.map((market, i) => {
      params[`valueMarket${i}`] = market;
      return `@valueMarket${i}`;
    });
    conditions.push(
      `(EXISTS (SELECT 1 FROM reference_odds r WHERE r.event_id = events.id AND r.scraped_at >= @referenceSince)
        OR EXISTS (SELECT 1 FROM reference_markets t WHERE t.event_id = events.id AND t.scraped_at >= @referenceSince)
        OR EXISTS (SELECT 1 FROM event_market_odds v WHERE v.event_id = events.id AND v.scraped_at >= @valueMarketsSince
                   AND v.market IN (${playerMarkets.join(", ")})))`
    );
  }
  return { whereClause: conditions.join(" AND "), params };
}

function eventLabel(participants: string[]): string {
  return participants.join(" - ");
}

// Case- and accent-insensitive substring match on "Home - Away", and the
// competition filter's, done in JS rather than SQL: SQLite's LIKE only folds
// ASCII case, participants are stored as a JSON array and a competition's name
// is cleaned of its season (competitionName). The fresh-events window keeps the
// scanned set small.
function scanFreshEvents(
  db: DatabaseSync,
  sport: string | undefined,
  q: string | undefined,
  oddsSince: string,
  filters?: ListingFilters
): { id: string; label: string }[] {
  const needle = q ? normalizeName(q) : "";
  const competition = filters?.competition ? competitionKey(filters.competition) : "";
  const { whereClause, params } = freshEventsFilter(sport, oddsSince, filters);
  const rows = db
    .prepare(`SELECT id, sport, competition, participants FROM events WHERE ${whereClause} ORDER BY start_time ASC`)
    .all(params) as { id: string; sport: string; competition: string; participants: string }[];
  return rows
    .map((r) => ({ id: r.id, label: eventLabel(JSON.parse(r.participants)), row: r }))
    .filter(
      (r) =>
        normalizeName(r.label).includes(needle) &&
        (!competition ||
          competitionKey(competitionName({ ...r.row, participants: JSON.parse(r.row.participants) })) === competition)
    )
    .map(({ id, label }) => ({ id, label }));
}

// Whether the listing is narrowed by something SQL can't tell: a search or a
// competition. Those lists are scanned in JS (scanFreshEvents).
const isScanned = (q: string | undefined, filters?: ListingFilters): boolean =>
  Boolean((q && normalizeName(q)) || filters?.competition);

// Every listable event's id, soonest kick-off first.
export function matchingEventIds(
  db: DatabaseSync,
  sport: string | undefined,
  q: string | undefined,
  oddsSince: string,
  filters?: ListingFilters
): string[] {
  if (isScanned(q, filters)) return scanFreshEvents(db, sport, q, oddsSince, filters).map((r) => r.id);
  const { whereClause, params } = freshEventsFilter(sport, oddsSince, filters);
  const rows = db
    .prepare(`SELECT id FROM events WHERE ${whereClause} ORDER BY start_time ASC`)
    .all(params) as { id: string }[];
  return rows.map((r) => r.id);
}

// The given events with their current odds, in the given order.
//
// The odds are the listing's, and the winner of the match that a bookmaker's
// markets cycle gave when its listing gives another market: Unibet's list gives
// a basketball match's result in regular time, and its winner, overtime
// included, only comes with the match's markets. That winner counts when the
// bookmaker still lists the match, and as long as the markets' prices do.
export function loadEvents(
  db: DatabaseSync,
  ids: string[],
  oddsSince: string,
  marketsSince: string = oddsSince
): EventWithOdds[] {
  if (ids.length === 0) return [];

  const idParams: Record<string, string> = {};
  const idPlaceholders = ids.map((id, i) => {
    idParams[`id${i}`] = id;
    return `@id${i}`;
  });
  const idList = idPlaceholders.join(", ");

  // Ordered so that each event's byBookmaker, and each bookmaker's odds, come
  // out in a stable order: the dashboard compares the market most bookmakers
  // list (the first bookmaker's first on a tie), and payoutRate must pick the
  // same one.
  const rows = db
    .prepare(
      `SELECT e.id, e.sport, e.competition, e.start_time as startTime, e.participants,
              o.bookmaker_id as bookmakerId, o.market, o.selection, o.price, o.scraped_at as scrapedAt
       FROM events e
       JOIN (
         SELECT event_id, bookmaker_id, market, selection, price, scraped_at FROM event_bookmaker_odds
         WHERE event_id IN (${idList}) AND scraped_at >= @oddsSince
         UNION ALL
         SELECT m.event_id, m.bookmaker_id, m.market, m.selection, m.price, m.scraped_at FROM event_market_odds m
         WHERE m.event_id IN (${idList}) AND m.market = @winner AND m.scraped_at >= @marketsSince
           AND EXISTS (SELECT 1 FROM event_bookmaker_odds l
                       WHERE l.event_id = m.event_id AND l.bookmaker_id = m.bookmaker_id AND l.scraped_at >= @oddsSince)
           AND NOT EXISTS (SELECT 1 FROM event_bookmaker_odds l
                           WHERE l.event_id = m.event_id AND l.bookmaker_id = m.bookmaker_id AND l.market = m.market
                             AND l.scraped_at >= @oddsSince)
       ) o ON o.event_id = e.id
       WHERE e.id IN (${idList})
       ORDER BY o.bookmaker_id, o.market, o.selection`
    )
    .all({ ...idParams, oddsSince, marketsSince, winner: MARKET_MATCH_WINNER }) as unknown as OddsRow[];

  const eventsById = new Map<string, EventWithOdds>();
  for (const row of rows) {
    let event = eventsById.get(row.id);
    if (!event) {
      event = {
        id: row.id,
        sport: row.sport,
        competition: row.competition,
        startTime: row.startTime,
        participants: JSON.parse(row.participants),
        byBookmaker: {},
      };
      eventsById.set(row.id, event);
    }
    if (!event.byBookmaker[row.bookmakerId]) {
      event.byBookmaker[row.bookmakerId] = { scrapedAt: row.scrapedAt, odds: [] };
    }
    event.byBookmaker[row.bookmakerId].odds.push({ market: row.market, selection: row.selection, price: row.price });
  }

  // Re-derive the order from ids rather than relying on the join query's row
  // order / Map insertion order.
  return ids.map((id) => eventsById.get(id)).filter((e): e is EventWithOdds => e !== undefined);
}

// Each event's markets with a current price: the main ones as fresh as the
// listing's, the others as fresh as the markets cycle's.
export function countMarkets(db: DatabaseSync, ids: string[], oddsSince: string, marketsSince: string): Map<string, number> {
  const counts = new Map<string, number>();
  // SQLite caps a statement's parameters (32766 by default): chunked.
  for (let start = 0; start < ids.length; start += 500) {
    const chunk = ids.slice(start, start + 500);
    const params: Record<string, string> = { oddsSince, marketsSince };
    const placeholders = chunk.map((id, i) => {
      params[`id${i}`] = id;
      return `@id${i}`;
    });
    const rows = db
      .prepare(
        `SELECT event_id AS id, COUNT(*) AS count FROM (
           SELECT DISTINCT event_id, market FROM event_bookmaker_odds
           WHERE event_id IN (${placeholders.join(", ")}) AND scraped_at >= @oddsSince
           UNION
           SELECT DISTINCT event_id, market FROM event_market_odds
           WHERE event_id IN (${placeholders.join(", ")}) AND scraped_at >= @marketsSince
         ) GROUP BY event_id`
      )
      .all(params) as { id: string; count: number }[];
    for (const row of rows) counts.set(row.id, row.count);
  }
  return counts;
}

export function getLatestEvents(
  db: DatabaseSync,
  opts: {
    sport?: string;
    q?: string;
    page?: number;
    pageSize?: number;
    sort?: EventSort;
    // The bookmakers whose prices count towards each match's TRJ; all when omitted.
    bookmakers?: readonly string[];
    // Only the matches with a players' market (scorers, assisters, decisive
    // players) at one of those bookmakers.
    players?: boolean;
    // The winners of the competitions, whatever their sport, instead of the
    // matches, or "all" of them (see ListingFilters).
    kind?: "competition" | "all";
    // Only this competition's events (see ListingFilters).
    competition?: string;
  } & ListingOptions = {}
): EventsPage {
  const oddsSince = oddsCutoff(opts);
  const marketsSince = marketsCutoff(opts);
  const filters: ListingFilters = {
    kind: opts.kind,
    competition: opts.competition,
    players: opts.players ? { marketsSince, bookmakers: opts.bookmakers } : undefined,
  };
  const page = clampPositiveInt(opts.page, 1, MAX_PAGE);
  const pageSize = clampPositiveInt(opts.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const offset = (page - 1) * pageSize;
  const listed = (events: EventWithOdds[]): ListedEvent[] => {
    const ids = events.map((e) => e.id);
    const counts = countMarkets(db, ids, oddsSince, marketsSince);
    const references = loadReferences(db, ids, oddsSince);
    return events.map((event) => {
      const reference = references.get(event.id) ?? null;
      return {
        ...event,
        payoutRate: payoutRate(event, opts.bookmakers),
        marketCount: counts.get(event.id) ?? 0,
        reference,
        value: reference ? bestValue(event, reference, opts.bookmakers) : null,
      };
    });
  };

  if (opts.sort === "trj" || opts.sort === "value") {
    // A match's rank depends on every other match's TRJ or edge, so the whole
    // filtered list is loaded and ranked before paging -- at most a few
    // thousand upcoming matches. Array.prototype.sort is stable: equal rates,
    // and matches without one, keep the kick-off order.
    const ids = matchingEventIds(db, opts.sport, opts.q, oddsSince, filters);
    const ranked = listed(loadEvents(db, ids, oddsSince, marketsSince));
    const byTrj = (a: ListedEvent, b: ListedEvent) => (b.payoutRate ?? -1) - (a.payoutRate ?? -1);
    if (opts.sort === "trj") ranked.sort(byTrj);
    if (opts.sort === "value") {
      const edge = (e: ListedEvent) => e.value?.edge ?? -Infinity;
      // Two matches without a reference: -Infinity - -Infinity is NaN, falsy.
      ranked.sort((a, b) => edge(b) - edge(a) || byTrj(a, b));
    }
    return { events: ranked.slice(offset, offset + pageSize), total: ranked.length, page, pageSize };
  }

  let total: number;
  let pageIds: string[];
  if (isScanned(opts.q, filters)) {
    const matching = matchingEventIds(db, opts.sport, opts.q, oddsSince, filters);
    total = matching.length;
    pageIds = matching.slice(offset, offset + pageSize);
  } else {
    const { whereClause, params } = freshEventsFilter(opts.sport, oddsSince, filters);
    total = (
      db.prepare(`SELECT COUNT(*) as count FROM events WHERE ${whereClause}`).get(params) as { count: number }
    ).count;
    const pageIdRows = db
      .prepare(`SELECT id FROM events WHERE ${whereClause} ORDER BY start_time ASC LIMIT @limit OFFSET @offset`)
      .all({ ...params, limit: pageSize, offset }) as { id: string }[];
    pageIds = pageIdRows.map((r) => r.id);
  }

  return { events: listed(loadEvents(db, pageIds, oddsSince, marketsSince)), total, page, pageSize };
}

// One value bet: a bookmaker's price at least VALUE_MIN_EDGE above the
// reference's fair odds of a match's 1X2 (src/db/value.ts), or one of its
// players' worth by any way of src/db/playerValue.ts.
export interface ValueBet {
  eventId: string;
  sport: string;
  competition: string;
  startTime: string;
  participants: string[];
  // Its match's markets with a current price, like the listing's.
  marketCount: number;
  // "1X2", "anytime_scorer", "scorer_goals|2"..., and its name.
  market: string;
  marketLabel: string;
  // The outcome ("1", "X", "2" or a player) and how it reads: the team,
  // "Nul", the player.
  selection: string;
  label: string;
  bookmaker: string;
  price: number;
  // What the price is weighed against: the fair odds ("fair"), the
  // exchange's lay as their ceiling ("lay"), or the other bookmaker's price
  // ("bookmaker": a suspect price), whose bookmaker `referenceBookmaker` is.
  basis: PlayerBasis;
  fair: number;
  referenceBookmaker?: string;
  edge: number;
  // Amount matched on the exchange's market, in euros; 0 when it has none.
  matched: number;
}

// "value": biggest edge first, ties by kick-off. "start": soonest kick-off
// first, a match's bets by edge.
export type ValueBetSort = "value" | "start";

// Every current value bet of the matches not started yet, among the given
// bookmakers (all when omitted): the dashboard's "Value bets" category. A
// handful at most -- the reference prices the football matches of the next
// 48 hours, a few dozen -- so there are no pages.
export function getValueBets(
  db: DatabaseSync,
  opts: { q?: string; sort?: ValueBetSort; bookmakers?: readonly string[] } & ListingOptions = {}
): { bets: ValueBet[]; total: number } {
  const oddsSince = oddsCutoff(opts);
  const marketsSince = marketsCutoff(opts);
  // The reference is as fresh as the listing's prices; ids in kick-off order.
  const ids = matchingEventIds(db, undefined, opts.q, oddsSince, {
    valueSources: { referenceSince: oddsSince, marketsSince },
  });
  const events = loadEvents(db, ids, oddsSince, marketsSince);
  const references = loadReferences(db, ids, oddsSince);
  const exchange = loadPlayerExchange(db, ids, oddsSince);
  const playerPrices = loadBookmakerPlayerPrices(db, ids, marketsSince);
  const tennisReference = loadTennisReference(db, ids, oddsSince);
  const counts = countMarkets(db, ids, oddsSince, marketsSince);
  const ticked = (bookmaker: string) => !opts.bookmakers || opts.bookmakers.includes(bookmaker);

  const byEvent: ValueBet[][] = [];
  for (const event of events) {
    const match = {
      eventId: event.id,
      sport: event.sport,
      competition: event.competition,
      startTime: event.startTime,
      participants: event.participants,
      marketCount: counts.get(event.id) ?? 0,
    };
    const bets: ValueBet[] = [];
    const reference = references.get(event.id);
    // Its main market: a 1X2 (football, ice hockey, rugby), a winner or, for
    // a golf tournament, the winner among its players.
    for (const bet of reference ? valueBetsOf(event, reference, opts.bookmakers) : []) {
      const outright = reference!.market === MARKET_OUTRIGHT;
      bets.push({
        ...match,
        market: reference!.market,
        marketLabel: outright ? "Tournament winner" : reference!.market === MARKET_1X2 ? "Match result" : "Match winner",
        selection: bet.selection,
        label: outright
          ? bet.selection
          : bet.selection === "X"
            ? "Draw"
            : (event.participants[bet.selection === "1" ? 0 : 1] ?? bet.selection),
        bookmaker: bet.bookmaker,
        price: bet.price,
        basis: "fair",
        fair: reference!.fair[bet.selection],
        edge: bet.edge,
        matched: reference!.matched,
      });
    }
    // The players', weighed against every bookmaker's prices, ticked or not.
    for (const [market, prices] of playerPrices.get(event.id) ?? []) {
      const parsed = parseMarketKey(market);
      const marketName = parsed.kind === "family" ? marketLabel(parsed.family, event.participants, parsed.line) : market;
      const known = exchange.get(event.id)?.get(market) ?? new Map();
      for (const signal of siteSignals(known, prices)) {
        if (!ticked(signal.bookmaker)) continue;
        bets.push({
          ...match,
          market,
          marketLabel: marketName,
          selection: signal.player,
          label: signal.player,
          bookmaker: signal.bookmaker,
          price: signal.price,
          basis: signal.basis,
          fair: signal.reference,
          ...(signal.referenceBookmaker ? { referenceBookmaker: signal.referenceBookmaker } : {}),
          edge: signal.edge,
          matched: known.get(signal.player)?.matched ?? 0,
        });
      }
    }
    // A tennis match's other markets, weighed the same way (src/db/tennisValue.ts).
    for (const [market, known] of tennisReference.get(event.id) ?? []) {
      const parsed = parseMarketKey(market);
      if (parsed.kind !== "family") continue;
      for (const signal of tennisSignals(known, tennisMarketPrices(db, event.id, market, marketsSince))) {
        if (!ticked(signal.bookmaker)) continue;
        bets.push({
          ...match,
          market,
          marketLabel: marketLabel(parsed.family, event.participants, parsed.line),
          selection: signal.player,
          label: outcomeLabel(parsed.family.key, signal.player, event.participants, parsed.line),
          bookmaker: signal.bookmaker,
          price: signal.price,
          basis: signal.basis,
          fair: signal.reference,
          edge: signal.edge,
          matched: known.get(signal.player)?.matched ?? 0,
        });
      }
    }
    byEvent.push(bets.sort((a, b) => b.edge - a.edge));
  }
  // Stable: the "start" order is the events' kick-off order, each one's bets
  // by edge.
  const bets = byEvent.flat();
  if (opts.sort !== "start") bets.sort((a, b) => b.edge - a.edge);
  return { bets, total: bets.length };
}

// One market's current prices at every bookmaker, by outcome.
function tennisMarketPrices(db: DatabaseSync, eventId: string, market: string, since: string): Map<string, Map<string, number>> {
  const rows = db
    .prepare(
      `SELECT bookmaker_id AS bookmaker, selection, price FROM event_market_odds
       WHERE event_id = @eventId AND market = @market AND scraped_at >= @since`
    )
    .all({ eventId, market, since }) as { bookmaker: string; selection: string; price: number }[];
  const byBookmaker = new Map<string, Map<string, number>>();
  for (const r of rows) byBookmaker.set(r.bookmaker, (byBookmaker.get(r.bookmaker) ?? new Map()).set(r.selection, r.price));
  return byBookmaker;
}

// Same filter as getLatestEvents: events are never deleted, so without it
// every sport string ever stored -- including labels only stale rows still
// carry, like pre-migration scrapers' -- would stay in the select forever,
// even with zero listable matches. The matches' list holds the competitions'
// winners too, so a sport with nothing but a winner is one of them.
export function getDistinctSports(db: DatabaseSync, opts: ListingOptions = {}): string[] {
  const { whereClause, params } = freshEventsFilter(undefined, oddsCutoff(opts), { kind: "all" });
  const rows = db
    .prepare(`SELECT DISTINCT sport FROM events WHERE ${whereClause} ORDER BY sport`)
    .all(params) as { sport: string }[];
  return rows.map((r) => r.sport);
}

const MIN_SUGGESTION_QUERY_LENGTH = 2;
const MAX_SUGGESTIONS = 10;

// Labels of fresh events matching q, soonest first, for the search box's
// autocomplete. Picking one and searching for it narrows the table to it.
export function getEventSuggestions(
  db: DatabaseSync,
  opts: { q?: string; sport?: string; kind?: "competition" | "all"; competition?: string } & ListingOptions
): string[] {
  if (!opts.q || normalizeName(opts.q).length < MIN_SUGGESTION_QUERY_LENGTH) return [];
  const oddsSince = oddsCutoff(opts);
  const labels = scanFreshEvents(db, opts.sport, opts.q, oddsSince, { kind: opts.kind, competition: opts.competition }).map(
    (r) => r.label
  );
  return [...new Set(labels)].slice(0, MAX_SUGGESTIONS);
}

// The competitions of the matches' list (matches and winners, `sport`'s when
// given), for the "Compétition" filter: each name once, as competitionName
// gives it, in alphabetical order.
export function getCompetitions(db: DatabaseSync, opts: { sport?: string } & ListingOptions = {}): string[] {
  const { whereClause, params } = freshEventsFilter(opts.sport, oddsCutoff(opts), { kind: "all" });
  const rows = db
    .prepare(`SELECT DISTINCT sport, competition, participants FROM events WHERE ${whereClause}`)
    .all(params) as { sport: string; competition: string; participants: string }[];
  const names = new Map<string, string>();
  for (const row of rows) {
    const name = competitionName({ ...row, participants: JSON.parse(row.participants) });
    if (name && !names.has(competitionKey(name))) names.set(competitionKey(name), name);
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b, "fr"));
}

// --- every market of a match (src/scraper/marketsRun.ts) ---------------------

// An event the markets cycle asks its bookmakers about: where each one lists
// it, with that bookmaker's own spelling and order of the participants.
export interface MarketTarget {
  eventId: string;
  sport: string;
  competition: string;
  participants: string[];
  sources: Record<string, EventSource>;
}

// Events of the given sports starting in the window, with the bookmakers that
// listed them since `seenSince`: one that stopped listing a match is not asked
// for its markets any more.
export function getMarketTargets(
  db: DatabaseSync,
  opts: { sports: readonly string[]; from: string; to: string; seenSince: string }
): MarketTarget[] {
  if (opts.sports.length === 0) return [];
  const sportParams: Record<string, string> = {};
  const sportPlaceholders = opts.sports.map((sport, i) => {
    sportParams[`sport${i}`] = sport;
    return `@sport${i}`;
  });
  const rows = db
    .prepare(
      `SELECT e.id, e.sport, e.competition, e.participants, s.bookmaker_id AS bookmakerId, s.source_id AS sourceId,
              s.participants AS sourceParticipants
       FROM events e JOIN event_sources s ON s.event_id = e.id
       WHERE e.sport IN (${sportPlaceholders.join(", ")}) AND NOT ${isCompetitionEventSql("e")}
         AND e.start_time > @from AND e.start_time <= @to AND s.seen_at >= @seenSince
       ORDER BY e.start_time ASC, e.id, s.bookmaker_id`
    )
    .all({ ...sportParams, from: opts.from, to: opts.to, seenSince: opts.seenSince }) as unknown as {
    id: string;
    sport: string;
    competition: string;
    participants: string;
    bookmakerId: string;
    sourceId: string;
    sourceParticipants: string;
  }[];

  const targets = new Map<string, MarketTarget>();
  for (const row of rows) {
    let target = targets.get(row.id);
    if (!target) {
      target = {
        eventId: row.id,
        sport: row.sport,
        competition: row.competition,
        participants: JSON.parse(row.participants),
        sources: {},
      };
      targets.set(row.id, target);
    }
    target.sources[row.bookmakerId] = { sourceId: row.sourceId, participants: JSON.parse(row.sourceParticipants) };
  }
  return [...targets.values()];
}

// One event's prices at one bookmaker, all markets but the listing's.
export interface EventMarketOdds {
  eventId: string;
  bookmakerId: string;
  odds: RawOdds[];
}

// Each event in its own transaction: a whole cycle's worth (hundreds of
// thousands of prices) in one would hold the database's write lock for
// seconds, longer than the listing's cycle waits for it (BUSY_TIMEOUT_MS).
//
// A bookmaker's prices of an event replace those it gave before: a market it
// no longer offers (suspended, closed, or named otherwise by a newer
// version) goes at once, instead of showing a price that no longer exists
// until it is too old. A bookmaker not read this time (a failed request)
// keeps its previous prices, which age out as usual.
export function saveMarketOdds(db: DatabaseSync, batches: readonly EventMarketOdds[], scrapedAt: string): void {
  const insertBookmaker = db.prepare(`INSERT INTO bookmakers (id, name) VALUES (@id, @name) ON CONFLICT(id) DO NOTHING`);
  const forget = db.prepare("DELETE FROM event_market_odds WHERE event_id = @eventId AND bookmaker_id = @bookmakerId");
  const insertOdds = db.prepare(INSERT_ODDS.replace("event_bookmaker_odds", "event_market_odds"));
  for (const { eventId, bookmakerId, odds } of batches) {
    if (odds.length === 0) continue;
    db.exec("BEGIN");
    try {
      insertBookmaker.run({ id: bookmakerId, name: bookmakerId });
      forget.run({ eventId, bookmakerId });
      for (const o of odds) {
        insertOdds.run({ eventId, bookmakerId, market: o.market, selection: o.selection, price: o.price, scrapedAt });
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
  for (const eventId of new Set(batches.filter((b) => b.odds.length > 0).map((b) => b.eventId))) {
    saveSurebetMarkets(db, eventId);
  }
}

// A match's markets whose bookmakers' best prices pay above 100%
// (surebet_markets), once all its bookmakers' are saved. SQLite first keeps
// those whose best prices' inverses add up to less than 1, out of thousands;
// then the same TRJ rule as a match's page (./marketGrid.ts).
function saveSurebetMarkets(db: DatabaseSync, eventId: string): void {
  // A golf tournament's markets have several winners (a Top 5 adds up to 5):
  // few of them, so none is left out here, the rate of each is checked below.
  const golf = (db.prepare("SELECT sport FROM events WHERE id = @eventId").get({ eventId }) as { sport: string } | undefined)?.sport === "golf";
  const maxSum = golf ? 1e9 : 1.000001;
  const rows = db
    .prepare(
      `SELECT o.bookmaker_id AS bookmaker, o.market, o.selection, o.price FROM event_market_odds o
       JOIN (
         SELECT market FROM (
           SELECT market, MAX(price) AS best FROM event_market_odds WHERE event_id = @eventId GROUP BY market, selection
         ) GROUP BY market HAVING SUM(1.0 / best) < @maxSum
       ) c ON c.market = o.market
       WHERE o.event_id = @eventId`
    )
    .all({ eventId, maxSum }) as { bookmaker: string; market: string; selection: string; price: number }[];
  const grids = new Map<string, Grid>();
  for (const r of rows) {
    if (!grids.has(r.market)) grids.set(r.market, new Map());
    const grid = grids.get(r.market)!;
    if (!grid.has(r.selection)) grid.set(r.selection, new Map());
    grid.get(r.selection)!.set(r.bookmaker, r.price);
  }
  const insert = db.prepare("INSERT INTO surebet_markets (event_id, market) VALUES (@eventId, @market)");
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM surebet_markets WHERE event_id = @eventId").run({ eventId });
    for (const [market, grid] of grids) {
      if ((payoutRateOf(parseMarketKey(market), grid) ?? 0) > 1) insert.run({ eventId, market });
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// Forgets the prices and sources of events that started before `before`.
// Events are otherwise never deleted, and a day of every market of a few
// hundred matches is about a million rows.
export function forgetStartedEvents(db: DatabaseSync, before: string): number {
  const started = "SELECT id FROM events WHERE start_time < @before";
  db.exec("BEGIN");
  try {
    let changes = 0;
    // Not the players' markets' stats (reference_player_stats...): they are
    // what a match's markets gave, read after it.
    const tables = [
      "event_bookmaker_odds",
      "event_market_odds",
      "surebet_markets",
      "event_sources",
      "reference_odds",
      "reference_sources",
      "reference_player_markets",
      "reference_player_odds",
      "reference_tennis_sources",
      "reference_markets",
    ];
    for (const table of tables) {
      changes += Number(db.prepare(`DELETE FROM ${table} WHERE event_id IN (${started})`).run({ before }).changes);
    }
    db.exec("COMMIT");
    return changes;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// Forgets what the players' markets and the alerts kept after kick-off, once
// it is older than `before`: those tables are the only ones nothing else ever
// deletes from. Each row counts from the last time it was touched, and its
// match was forgotten long before (forgetStartedEvents), so nothing is cut
// from what a page shows of a recent match.
export function forgetOldStats(db: DatabaseSync, before: string): number {
  const tables: [table: string, column: string][] = [
    ["reference_player_stats", "last_seen_at"],
    ["reference_player_signals", "last_seen_at"],
    ["reference_player_cycles", "at"],
    ["gem_alerts", "sent_at"],
  ];
  db.exec("BEGIN");
  try {
    let changes = 0;
    for (const [table, column] of tables) {
      changes += Number(db.prepare(`DELETE FROM ${table} WHERE ${column} < @before`).run({ before }).changes);
    }
    db.exec("COMMIT");
    return changes;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
