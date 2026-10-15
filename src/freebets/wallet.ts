import { DatabaseSync } from "node:sqlite";
import { ALL_BOOKMAKER_IDS } from "../alerts/gems";
import { BookmakerId } from "../scraper/canonical";

// What an account holds in freebets, by bookmaker, in FB (1 FB is 1 euro, two
// decimals at most): the Freebets page turns it into cash. A bookmaker where
// the account holds nothing is absent, not 0.
export type Wallet = Partial<Record<BookmakerId, number>>;

// The most one bookmaker can hold. A typo ("2500000") must not reach the
// calculations; no welcome offer comes anywhere near.
export const MAX_FREEBET = 10_000;

const toCents = (amount: number) => Math.round(amount * 100);

// The wallet in a PUT's body, or null when it is not one. What an honest client
// can get wrong (a sum beyond the cent, a bookmaker the site has dropped) is
// corrected; what cannot be is refused.
export function parseWallet(input: unknown): Wallet | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const wallet: Wallet = {};
  for (const id of ALL_BOOKMAKER_IDS) {
    // The body's own keys only: an inherited one is not the client's.
    if (!Object.hasOwn(input, id)) continue;
    const amount = (input as Record<string, unknown>)[id];
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || amount > MAX_FREEBET) return null;
    const cents = toCents(amount);
    if (cents > 0) wallet[id] = cents / 100;
  }
  return wallet;
}

export function getWallet(db: DatabaseSync, userId: string): Wallet {
  const rows = db.prepare("SELECT bookmaker, amount_cents FROM user_freebets WHERE user_id = ?").all(userId) as {
    bookmaker: string;
    amount_cents: number;
  }[];
  const cents = new Map(rows.map((row) => [row.bookmaker, row.amount_cents]));
  const wallet: Wallet = {};
  // The site's bookmakers, in its order: a row of one it has dropped stays in the
  // table but never reaches the page.
  for (const id of ALL_BOOKMAKER_IDS) {
    const amount = cents.get(id);
    if (amount !== undefined) wallet[id] = amount / 100;
  }
  return wallet;
}

// Replaces the account's wallet. One transaction: a failure leaves the wallet
// it had, never half of the new one.
export function saveWallet(db: DatabaseSync, userId: string, wallet: Wallet, now = new Date()): void {
  const updatedAt = now.toISOString();
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM user_freebets WHERE user_id = ?").run(userId);
    const insert = db.prepare("INSERT INTO user_freebets (user_id, bookmaker, amount_cents, updated_at) VALUES (?, ?, ?, ?)");
    for (const [bookmaker, amount] of Object.entries(wallet)) {
      const cents = toCents(amount ?? 0);
      if (cents > 0) insert.run(userId, bookmaker, cents, updatedAt);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
