import { DatabaseSync } from "node:sqlite";

// Each bookmaker's last read by the scraping cycle (src/scraper/run.ts): when,
// how many matches it gave or why it failed, and its last good read (one with
// matches). The administration shows it (GET /api/admin/bookmakers), the
// admin alerts watch it (src/alerts/health.ts).

// A bookmaker is down when it has given no match for this long: six cycles of
// 5 minutes, long enough to let one or two failed reads pass.
export const DOWN_AFTER_MS = 30 * 60 * 1000;

export type BookmakerHealth = "ok" | "failing" | "empty" | "paused" | "down";

export interface BookmakerStatus {
  bookmaker: string;
  lastReadAt: string;
  // The matches of the last read, null when it failed.
  lastEvents: number | null;
  lastError: string | null;
  lastGoodAt: string | null;
  lastGoodEvents: number | null;
  // "ok": the last read gave matches. "failing" or "empty": it did not, but a
  // good read is recent. "paused": it did not, but it is read only so often
  // (The Odds API's paced reads, src/scraper/oddsApi.ts) and its last good
  // read is within that pace. "down": no good read for DOWN_AFTER_MS (or its
  // pace and DOWN_AFTER_MS when it has one).
  health: BookmakerHealth;
  // Whether the admin alert of its being down was sent (and its recovery not yet).
  downAlerted: boolean;
  // While paused, when its next paced read is due: its last good read plus its pace.
  nextReadAt?: string;
}

// A read: the matches it gave, or the error it failed with.
export type BookmakerRead = { events: number } | { error: string };

export function recordBookmakerRead(db: DatabaseSync, bookmaker: string, read: BookmakerRead, at = new Date().toISOString()): void {
  const events = "events" in read ? read.events : null;
  const error = "error" in read ? read.error.slice(0, 500) : null;
  const good = events !== null && events > 0;
  db.prepare(
    `INSERT INTO bookmaker_status (bookmaker_id, last_read_at, last_events, last_error, last_good_at, last_good_events)
     VALUES (@bookmaker, @at, @events, @error, @goodAt, @goodEvents)
     ON CONFLICT(bookmaker_id) DO UPDATE SET
       last_read_at = excluded.last_read_at,
       last_events = excluded.last_events,
       last_error = excluded.last_error,
       last_good_at = COALESCE(excluded.last_good_at, last_good_at),
       last_good_events = COALESCE(excluded.last_good_events, last_good_events)`
  ).run({ bookmaker, at, events, error, goodAt: good ? at : null, goodEvents: good ? events : null });
}

export function setDownAlerted(db: DatabaseSync, bookmaker: string, alerted: boolean): void {
  db.prepare("UPDATE bookmaker_status SET down_alerted = ? WHERE bookmaker_id = ?").run(alerted ? 1 : 0, bookmaker);
}

interface Row {
  bookmaker: string;
  lastReadAt: string;
  lastEvents: number | null;
  lastError: string | null;
  lastGoodAt: string | null;
  lastGoodEvents: number | null;
  downAlerted: number;
}

// How long a bookmaker read only so often goes between two reads, by id (ms):
// between them, no price is no failure.
export type BookmakerPace = Readonly<Record<string, number>>;

export function healthOf(row: Pick<Row, "lastEvents" | "lastError" | "lastGoodAt">, now: number, paceMs = 0): BookmakerHealth {
  if (row.lastEvents !== null && row.lastEvents > 0) return "ok";
  const since = row.lastGoodAt ? now - Date.parse(row.lastGoodAt) : Infinity;
  if (row.lastError === null && paceMs > DOWN_AFTER_MS && since < paceMs + DOWN_AFTER_MS) return "paused";
  if (since >= DOWN_AFTER_MS) return "down";
  return row.lastError !== null ? "failing" : "empty";
}

export function listBookmakerStatus(db: DatabaseSync, now = Date.now(), pace: BookmakerPace = {}): BookmakerStatus[] {
  const rows = db
    .prepare(
      `SELECT bookmaker_id AS bookmaker, last_read_at AS lastReadAt, last_events AS lastEvents, last_error AS lastError,
              last_good_at AS lastGoodAt, last_good_events AS lastGoodEvents, down_alerted AS downAlerted
       FROM bookmaker_status ORDER BY bookmaker_id`
    )
    .all() as unknown as Row[];
  return rows.map((row) => {
    const health = healthOf(row, now, pace[row.bookmaker]);
    const next = health === "paused" && row.lastGoodAt ? { nextReadAt: new Date(Date.parse(row.lastGoodAt) + pace[row.bookmaker]).toISOString() } : {};
    return { ...row, health, downAlerted: row.downAlerted === 1, ...next };
  });
}

// Each bookmaker's last read, one line each, for `npm run bookmaker-status`
// (vps-report bookmakers): its health, when it was last read and what it
// gave, and its last error, so that a scraper failing in production shows
// from outside the server.
export function formatBookmakerStatus(statuses: readonly BookmakerStatus[], now = Date.now()): string {
  if (statuses.length === 0) return "No bookmaker read yet.";
  const ago = (iso: string | null) => (iso === null ? "never" : `${Math.round((now - Date.parse(iso)) / 60_000)} min ago`);
  return statuses
    .map((s) => {
      const last = s.lastEvents === null ? "failed" : `${s.lastEvents} matches`;
      const good = s.lastGoodAt === null ? "no good read" : `last good ${ago(s.lastGoodAt)} (${s.lastGoodEvents ?? 0} matches)`;
      const error = s.lastError ? `\n    error: ${s.lastError.replace(/\s+/g, " ").slice(0, 300)}` : "";
      const next = s.nextReadAt ? `; ${nextReadLabel(s.nextReadAt, now)}` : "";
      return `${s.health.toUpperCase().padEnd(7)} ${s.bookmaker.padEnd(12)} read ${ago(s.lastReadAt)}: ${last}; ${good}${next}${error}`;
    })
    .join("\n");
}

// "next read in about 9 h", "next read in about 40 min", "next read due now".
export function nextReadLabel(nextReadAt: string, now = Date.now()): string {
  const minutes = Math.round((Date.parse(nextReadAt) - now) / 60_000);
  if (minutes <= 0) return "next read due now";
  return minutes < 90 ? `next read in about ${minutes} min` : `next read in about ${Math.round(minutes / 60)} h`;
}
