import { DatabaseSync } from "node:sqlite";
import { ALL_BOOKMAKER_IDS } from "../alerts/gems";
import { BookmakerId } from "../scraper/canonical";

// LUGAS (the German regulator's cross-operator system) caps what a player
// deposits at all German-licensed (GGL) bookmakers together: 1,000 euros a
// calendar month by default. The site cannot see deposits; an account writes
// down its own, per bookmaker, and sees what is left of the month's limit.
// Not legal advice: a raised personal limit, or another one, is the user's.
export const LUGAS_MONTHLY_LIMIT = 1000;

// The bookmakers LUGAS counts: the site's, but those without a German licence
// (20bet), which LUGAS does not see.
export const LUGAS_BOOKMAKERS: readonly BookmakerId[] = ALL_BOOKMAKER_IDS.filter((id) => id !== "twentybet");

// A typo ("100000") must not count; no single month's deposit comes near.
export const MAX_DEPOSIT = 100_000;

export type Deposits = Partial<Record<BookmakerId, number>>;

const MONTH = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit" });

// The calendar month in Germany, "2026-11": LUGAS's months are German ones.
export const lugasMonth = (now: Date): string => MONTH.format(now).slice(0, 7);

const toCents = (amount: number) => Math.round(amount * 100);

// The deposits of a PUT's body, or null when they are not deposits. A
// bookmaker LUGAS does not count is left out; a negative or absurd amount
// refuses the whole.
export function parseDeposits(input: unknown): Deposits | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const deposits: Deposits = {};
  for (const id of LUGAS_BOOKMAKERS) {
    if (!Object.hasOwn(input, id)) continue;
    const amount = (input as Record<string, unknown>)[id];
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || amount > MAX_DEPOSIT) return null;
    const cents = toCents(amount);
    if (cents > 0) deposits[id] = cents / 100;
  }
  return deposits;
}

export interface MonthDeposits {
  month: string;
  deposits: Deposits;
  total: number;
  // The account's own limit, else LUGAS_MONTHLY_LIMIT.
  limit: number;
  // Whether `limit` is the account's own.
  personalLimit: boolean;
}

// The most a personal limit can be: LUGAS allows a raise to 30,000 euros at most
// (a typo must not count either).
export const MAX_LIMIT = 30_000;

// A limit in a PUT's body: undefined when absent (unchanged), null to go back
// to the default, a number of euros; "invalid" when it is none of them.
export function parseLimit(input: unknown): number | null | undefined | "invalid" {
  if (input === undefined) return undefined;
  if (input === null) return null;
  if (typeof input !== "number" || !Number.isFinite(input) || input <= 0 || input > MAX_LIMIT) return "invalid";
  return toCents(input) / 100;
}

export function setDepositLimit(db: DatabaseSync, userId: string, limit: number | null, now = new Date()): void {
  if (limit === null) {
    db.prepare("DELETE FROM user_deposit_limit WHERE user_id = ?").run(userId);
    return;
  }
  db.prepare(
    `INSERT INTO user_deposit_limit (user_id, limit_cents, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET limit_cents = excluded.limit_cents, updated_at = excluded.updated_at`
  ).run(userId, toCents(limit), now.toISOString());
}

// The account's deposits of this month: last month's are gone with it.
export function getDeposits(db: DatabaseSync, userId: string, now = new Date()): MonthDeposits {
  const month = lugasMonth(now);
  const rows = db.prepare("SELECT bookmaker, amount_cents FROM user_deposits WHERE user_id = ? AND month = ?").all(userId, month) as {
    bookmaker: string;
    amount_cents: number;
  }[];
  const cents = new Map(rows.map((r) => [r.bookmaker, r.amount_cents]));
  const deposits: Deposits = {};
  let total = 0;
  for (const id of LUGAS_BOOKMAKERS) {
    const amount = cents.get(id);
    if (amount === undefined) continue;
    deposits[id] = amount / 100;
    total += amount;
  }
  const own = db.prepare("SELECT limit_cents FROM user_deposit_limit WHERE user_id = ?").get(userId) as { limit_cents: number } | undefined;
  return {
    month,
    deposits,
    total: total / 100,
    limit: own ? own.limit_cents / 100 : LUGAS_MONTHLY_LIMIT,
    personalLimit: own !== undefined,
  };
}

// Replaces this month's deposits, in one transaction; older months' rows go.
export function saveDeposits(db: DatabaseSync, userId: string, deposits: Deposits, now = new Date()): void {
  const month = lugasMonth(now);
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM user_deposits WHERE user_id = ?").run(userId);
    const insert = db.prepare("INSERT INTO user_deposits (user_id, month, bookmaker, amount_cents, updated_at) VALUES (?, ?, ?, ?, ?)");
    for (const [bookmaker, amount] of Object.entries(deposits)) {
      const cents = toCents(amount ?? 0);
      if (cents > 0) insert.run(userId, month, bookmaker, cents, now.toISOString());
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
