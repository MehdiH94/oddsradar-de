import { DatabaseSync } from "node:sqlite";
import { EXCHANGE_COMMISSION } from "../db/surebets";
import { lugasMonth } from "../deposits/deposits";

// The surebets an account has marked as taken (web/src/takenSurebets.ts): the
// dashboard shows them so on every device and puts them last. One with a bet
// at the exchange (a lay or a back) can ask for a reminder by email an hour
// before kick-off, to check it was matched there (the owner, 26/10/2026): an
// unmatched exchange bet leaves the others uncovered.
//
// What the client sends is only ever about its own account: a wrong label or
// time reaches its own inbox, at worst. It is still checked, and capped.

export interface TakenSurebet {
  // The dashboard's identity of a surebet: its match, market and legs, not
  // their prices, which move (web/src/takenSurebets.ts, surebetKey).
  key: string;
  eventId: string;
  startTime: string;
  // "Galatasaray - Fenerbahçe, Ergebnis: Lay 1 an der Börse 2,10 / …", the
  // reminder's text.
  label: string;
  remind: boolean;
  // Its payout when taken (1.024 for +2.4 %), null when not sent or out of
  // reason: a surebet pays over 100 %, and the site shows none over 150 %.
  payoutRate: number | null;
  // Its legs as taken, null when not sent or not readable.
  legs: TakenLeg[] | null;
}

// A leg as taken: where, which outcome, and its price then.
export interface TakenLeg {
  market: string;
  selection: string;
  // A bookmaker's id, or "exchange".
  source: string;
  side: "back" | "lay";
  price: number;
}

const MAX_LEGS = 6;

// The legs sent, or null when any of them is not one: they are only shown
// back to the same account, still checked and capped.
export function parseTakenLegs(input: unknown): TakenLeg[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_LEGS) return null;
  const legs: TakenLeg[] = [];
  for (const item of input) {
    if (typeof item !== "object" || item === null) return null;
    const { market, selection, source, side, price } = item as Record<string, unknown>;
    if (typeof market !== "string" || typeof selection !== "string" || typeof source !== "string") return null;
    if (side !== "back" && side !== "lay") return null;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 1 || price > 1000) return null;
    const [m, sel, src] = [clean(market, 100), clean(selection, 200), clean(source, 40)];
    if (!m || !sel || !src) return null;
    legs.push({ market: m, selection: sel, source: src, side, price });
  }
  return legs;
}

const readLegs = (json: string | null): TakenLeg[] | null => {
  if (json === null) return null;
  try {
    return parseTakenLegs(JSON.parse(json));
  } catch {
    return null;
  }
};

export const MAX_KEY = 500;
export const MAX_LABEL = 400;
// How many an account keeps at once: plenty for a day's betting.
export const MAX_TAKEN = 200;
// Kept this long after kick-off, then forgotten.
export const KEEP_AFTER_START_MS = 2 * 24 * 60 * 60 * 1000;
// The reminder, this long before kick-off.
export const REMIND_BEFORE_MS = 60 * 60 * 1000;

// Printable text only, on one line.
const clean = (value: string, max: number) => value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);

// The body of a PUT, or null when it is not a taken surebet.
export function parseTakenSurebet(input: unknown, now = new Date()): TakenSurebet | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const { key, eventId, startTime, label, remind, payoutRate, legs } = input as Record<string, unknown>;
  if (typeof key !== "string" || typeof eventId !== "string" || typeof startTime !== "string" || typeof label !== "string") return null;
  if (typeof remind !== "boolean") return null;
  const start = Date.parse(startTime);
  // A match of the next month, or one started less than its keeping time ago.
  if (!Number.isFinite(start) || start < now.getTime() - KEEP_AFTER_START_MS || start > now.getTime() + 31 * 24 * 60 * 60 * 1000) return null;
  // The key is matched as sent: one with control characters or over the cap
  // is refused, not rewritten.
  const k = key.trim();
  const id = clean(eventId, 200);
  if (!k || !id || k.length > MAX_KEY || /[\u0000-\u001f\u007f]/.test(k)) return null;
  const rate = typeof payoutRate === "number" && Number.isFinite(payoutRate) && payoutRate > 1 && payoutRate <= 1.5 ? payoutRate : null;
  return {
    key: k,
    eventId: id,
    startTime: new Date(start).toISOString(),
    label: clean(label, MAX_LABEL) || id,
    remind,
    payoutRate: rate,
    legs: parseTakenLegs(legs),
  };
}

// The account's taken surebets, soonest first: each with what the dashboard's
// "Meine Surebets" shows (web/src/MyTakenSurebets.tsx).
export interface ListedTakenSurebet {
  key: string;
  remind: boolean;
  eventId: string;
  startTime: string;
  label: string;
  remindedAt: string | null;
  payoutRate: number | null;
  legs: TakenLeg[] | null;
  // The stakes actually placed, by leg (null: not written down), or null.
  stakes: (number | null)[] | null;
}

export function listTakenSurebets(db: DatabaseSync, userId: string): ListedTakenSurebet[] {
  const rows = db
    .prepare(
      `SELECT surebet_key AS key, remind, event_id AS eventId, start_time AS startTime, label, reminded_at AS remindedAt,
              payout_rate AS payoutRate, legs, stakes
       FROM user_taken_surebets WHERE user_id = ? ORDER BY start_time, surebet_key`
    )
    .all(userId) as unknown as (Omit<ListedTakenSurebet, "remind" | "legs" | "stakes"> & { remind: number; legs: string | null; stakes: string | null })[];
  return rows.map((r) => ({ ...r, remind: r.remind === 1, legs: readLegs(r.legs), stakes: readStakes(r.stakes) }));
}

// False when the account already keeps MAX_TAKEN others.
export function saveTakenSurebet(db: DatabaseSync, userId: string, taken: TakenSurebet, now = new Date()): boolean {
  const known = db.prepare("SELECT 1 FROM user_taken_surebets WHERE user_id = ? AND surebet_key = ?").get(userId, taken.key);
  if (!known) {
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM user_taken_surebets WHERE user_id = ?").get(userId) as { n: number };
    if (n >= MAX_TAKEN) return false;
  }
  // Asking again for a reminder already sent sends none: the time has passed.
  // The payout and the legs' prices stay those it was taken at, whatever the
  // prices became since.
  db.prepare(
    `INSERT INTO user_taken_surebets (user_id, surebet_key, event_id, start_time, label, remind, created_at, payout_rate, legs)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, surebet_key) DO UPDATE SET
       event_id = excluded.event_id, start_time = excluded.start_time, label = excluded.label, remind = excluded.remind,
       payout_rate = COALESCE(payout_rate, excluded.payout_rate), legs = COALESCE(legs, excluded.legs)`
  ).run(
    userId,
    taken.key,
    taken.eventId,
    taken.startTime,
    taken.label,
    taken.remind ? 1 : 0,
    now.toISOString(),
    taken.payoutRate ?? null,
    taken.legs ? JSON.stringify(taken.legs) : null
  );
  return true;
}

// The most a stake can be: a typo must not count.
export const MAX_STAKE = 100_000;

// The stakes of a body: one per leg at most MAX_LEGS, each an amount in euros
// to the cent or null; null when they are not that.
export function parseStakes(input: unknown): (number | null)[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_LEGS) return null;
  const stakes: (number | null)[] = [];
  for (const s of input) {
    if (s === null) stakes.push(null);
    else if (typeof s === "number" && Number.isFinite(s) && s >= 0 && s <= MAX_STAKE) stakes.push(Math.round(s * 100) / 100);
    else return null;
  }
  return stakes;
}

function readStakes(json: string | null): (number | null)[] | null {
  if (json === null) return null;
  try {
    return parseStakes(JSON.parse(json));
  } catch {
    return null;
  }
}

// Writes down the stakes placed on one of the account's taken surebets; false
// when it holds no such surebet. All null forgets them.
export function saveStakes(db: DatabaseSync, userId: string, key: string, stakes: (number | null)[]): boolean {
  const json = stakes.every((s) => s === null) ? null : JSON.stringify(stakes);
  return db.prepare("UPDATE user_taken_surebets SET stakes = ? WHERE user_id = ? AND surebet_key = ?").run(json, userId, key).changes > 0;
}

export function deleteTakenSurebet(db: DatabaseSync, userId: string, key: string): void {
  db.prepare("DELETE FROM user_taken_surebets WHERE user_id = ? AND surebet_key = ?").run(userId, key);
}

export interface DueReminder {
  userId: string;
  key: string;
  email: string;
  eventId: string;
  startTime: string;
  label: string;
}

// The reminders to send now: asked for, not sent, the match starting within
// the hour and not yet started, the account active.
export function dueReminders(db: DatabaseSync, now = new Date()): DueReminder[] {
  return db
    .prepare(
      `SELECT t.user_id AS userId, t.surebet_key AS key, u.email, t.event_id AS eventId, t.start_time AS startTime, t.label
       FROM user_taken_surebets t JOIN users u ON u.id = t.user_id
       WHERE t.remind = 1 AND t.reminded_at IS NULL AND u.status = 'active'
         AND t.start_time > ? AND t.start_time <= ?
       ORDER BY t.start_time`
    )
    .all(now.toISOString(), new Date(now.getTime() + REMIND_BEFORE_MS).toISOString()) as unknown as DueReminder[];
}

export function markReminded(db: DatabaseSync, userId: string, key: string, now = new Date()): void {
  db.prepare("UPDATE user_taken_surebets SET reminded_at = ? WHERE user_id = ? AND surebet_key = ?").run(now.toISOString(), userId, key);
}

// What the stakes placed lock in, in euros: the worst result over the
// outcomes, each leg settled as the surebets list computes it (a back at the
// exchange or a won lay less the exchange's commission on its winnings; a
// lost lay costs its liability). With a lay, the outcomes are its selection
// winning or not. Null without legs or a stake on each. The same as the
// dashboard's (web/src/takenSurebets.ts, lockedResult).
export function lockedProfit(legs: readonly TakenLeg[] | null, stakes: readonly (number | null)[] | null): number | null {
  if (!legs || !stakes || legs.length === 0 || legs.some((_, i) => typeof stakes[i] !== "number")) return null;
  const stake = (i: number) => stakes[i] as number;
  if (legs.every((_, i) => stake(i) === 0)) return null;
  const settle = (winner: string | null) =>
    legs.reduce((sum, l, i) => {
      const wins = l.selection === winner;
      if (l.side === "lay") return sum + (wins ? -stake(i) * (l.price - 1) : stake(i) * (1 - EXCHANGE_COMMISSION));
      const cut = l.source === "exchange" ? 1 - EXCHANGE_COMMISSION : 1;
      return sum + (wins ? stake(i) * (l.price - 1) * cut : -stake(i));
    }, 0);
  // A back and its lay share one selection: the other outcome is any other.
  const outcomes: (string | null)[] = [...new Set(legs.map((l) => l.selection))];
  if (outcomes.length === 1 && legs.some((l) => l.side === "lay")) outcomes.push(null);
  return Math.min(...outcomes.map(settle));
}

// How long a result is kept: a year and a month, for a year's months.
const KEEP_RESULTS_MS = 400 * 24 * 60 * 60 * 1000;

// Forgets the surebets whose match is long over, first keeping what those
// with stakes locked in (user_surebet_results), and the results over a year old.
export function purgeTakenSurebets(db: DatabaseSync, now = new Date()): void {
  const before = new Date(now.getTime() - KEEP_AFTER_START_MS).toISOString();
  const over = db
    .prepare("SELECT user_id AS userId, surebet_key AS key, start_time AS startTime, legs, stakes FROM user_taken_surebets WHERE start_time < ? AND stakes IS NOT NULL")
    .all(before) as { userId: string; key: string; startTime: string; legs: string | null; stakes: string | null }[];
  const keep = db.prepare(
    `INSERT INTO user_surebet_results (user_id, surebet_key, start_time, month, profit_cents) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, surebet_key) DO UPDATE SET start_time = excluded.start_time, month = excluded.month, profit_cents = excluded.profit_cents`
  );
  db.exec("BEGIN");
  try {
    for (const row of over) {
      const profit = lockedProfit(readLegs(row.legs), readStakes(row.stakes));
      if (profit !== null) keep.run(row.userId, row.key, row.startTime, lugasMonth(new Date(row.startTime)), Math.round(profit * 100));
    }
    db.prepare("DELETE FROM user_taken_surebets WHERE start_time < ?").run(before);
    db.prepare("DELETE FROM user_surebet_results WHERE start_time < ?").run(new Date(now.getTime() - KEEP_RESULTS_MS).toISOString());
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// The results kept for the account's surebets played in the month of `now`
// (Berlin), their taken surebets already forgotten: their sum and how many.
export function monthResults(db: DatabaseSync, userId: string, now = new Date()): { month: string; profit: number; count: number } {
  const month = lugasMonth(now);
  const { cents, n } = db
    .prepare("SELECT COALESCE(SUM(profit_cents), 0) AS cents, COUNT(*) AS n FROM user_surebet_results WHERE user_id = ? AND month = ?")
    .get(userId, month) as { cents: number; n: number };
  return { month, profit: cents / 100, count: n };
}
