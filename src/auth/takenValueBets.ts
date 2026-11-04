import { DatabaseSync } from "node:sqlite";
import { KEEP_AFTER_START_MS, MAX_KEY, MAX_LABEL } from "./takenSurebets";

// The value bets an account has marked as taken (web/src/takenValueBets.ts):
// greyed and last on the dashboard's list, and in "Meine Value Bets" with the
// edge they were taken at and, once their match started, their closing price
// (src/db/closingPrices.ts), the first measure of the value really taken.
// Like the taken surebets, what the client sends is only ever shown back to
// its own account; it is still checked, and capped.

export interface TakenValueBet {
  // The dashboard's identity of a value bet: its match, market, outcome and
  // bookmaker, not its price, which moves (web/src/takenValueBets.ts).
  key: string;
  eventId: string;
  startTime: string;
  // "Galatasaray - Fenerbahçe, Ergebnis: Fenerbahçe", as the list shows it.
  label: string;
  market: string;
  selection: string;
  bookmaker: string;
  // Its price and edge when taken (0.021 for +2.1 %).
  price: number;
  edge: number;
}

// How many an account keeps at once.
export const MAX_TAKEN_VALUE_BETS = 200;

const clean = (value: string, max: number) => value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);

// The body of a PUT, or null when it is not a taken value bet.
export function parseTakenValueBet(input: unknown, now = new Date()): TakenValueBet | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const { key, eventId, startTime, label, market, selection, bookmaker, price, edge } = input as Record<string, unknown>;
  for (const s of [key, eventId, startTime, label, market, selection, bookmaker]) if (typeof s !== "string") return null;
  const start = Date.parse(startTime as string);
  if (!Number.isFinite(start) || start < now.getTime() - KEEP_AFTER_START_MS || start > now.getTime() + 31 * 24 * 60 * 60 * 1000) return null;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 1 || price > 1000) return null;
  // A value bet's edge is positive; the site shows none over 100 %.
  if (typeof edge !== "number" || !Number.isFinite(edge) || edge <= 0 || edge > 1) return null;
  const k = (key as string).trim();
  if (!k || k.length > MAX_KEY || /[\u0000-\u001f\u007f]/.test(k)) return null;
  const [id, m, sel, bm] = [clean(eventId as string, 200), clean(market as string, 100), clean(selection as string, 200), clean(bookmaker as string, 40)];
  if (!id || !m || !sel || !bm) return null;
  return {
    key: k,
    eventId: id,
    startTime: new Date(start).toISOString(),
    label: clean(label as string, MAX_LABEL) || id,
    market: m,
    selection: sel,
    bookmaker: bm,
    price,
    edge,
  };
}

// The account's taken value bets, soonest first.
export function listTakenValueBets(db: DatabaseSync, userId: string): TakenValueBet[] {
  return db
    .prepare(
      `SELECT bet_key AS key, event_id AS eventId, start_time AS startTime, label, market, selection, bookmaker, price, edge
       FROM user_taken_value_bets WHERE user_id = ? ORDER BY start_time, bet_key`
    )
    .all(userId) as unknown as TakenValueBet[];
}

// False when the account already keeps MAX_TAKEN_VALUE_BETS others. Marked
// again, it keeps the price and edge it was first taken at.
export function saveTakenValueBet(db: DatabaseSync, userId: string, bet: TakenValueBet, now = new Date()): boolean {
  const known = db.prepare("SELECT 1 FROM user_taken_value_bets WHERE user_id = ? AND bet_key = ?").get(userId, bet.key);
  if (!known) {
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM user_taken_value_bets WHERE user_id = ?").get(userId) as { n: number };
    if (n >= MAX_TAKEN_VALUE_BETS) return false;
  }
  db.prepare(
    `INSERT INTO user_taken_value_bets (user_id, bet_key, event_id, start_time, label, market, selection, bookmaker, price, edge, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, bet_key) DO UPDATE SET event_id = excluded.event_id, start_time = excluded.start_time, label = excluded.label`
  ).run(userId, bet.key, bet.eventId, bet.startTime, bet.label, bet.market, bet.selection, bet.bookmaker, bet.price, bet.edge, now.toISOString());
  return true;
}

export function deleteTakenValueBet(db: DatabaseSync, userId: string, key: string): void {
  db.prepare("DELETE FROM user_taken_value_bets WHERE user_id = ? AND bet_key = ?").run(userId, key);
}

// Forgets the value bets whose match is long over.
export function purgeTakenValueBets(db: DatabaseSync, now = new Date()): void {
  db.prepare("DELETE FROM user_taken_value_bets WHERE start_time < ?").run(new Date(now.getTime() - KEEP_AFTER_START_MS).toISOString());
}
