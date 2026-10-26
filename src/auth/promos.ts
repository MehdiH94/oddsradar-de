import { DatabaseSync } from "node:sqlite";

// The bookmakers' promotions (web/src/promos/PromosPage.tsx): a deposit
// bonus, a boosted price, a freebet for a bet, an insurance… The owner wants
// them in one place, each marked once taken, so that none is missed, and
// then to work out how to clear each one's bonus (26/10/2026).
//
// For now an account adds the ones it receives (by email, on Telegram, on the
// bookmaker's site), seen by it alone. Later the site reads some itself (its
// readers write `source` "site" or "telegram", no owner: everyone's).

export type PromoSource = "manual" | "site" | "telegram" | "email";

export interface Promo {
  id: number;
  source: PromoSource;
  // A bookmaker of the site's ("leovegas") or any other's name ("Stake").
  bookmaker: string;
  title: string;
  details: string;
  url: string | null;
  endsAt: string | null;
  foundAt: string;
  // Added by this account: it alone sees it, and may take it away.
  mine: boolean;
  takenAt: string | null;
}

export interface NewPromo {
  bookmaker: string;
  title: string;
  details: string;
  url: string | null;
  endsAt: string | null;
}

export const MAX_TITLE = 160;
export const MAX_DETAILS = 2000;
export const MAX_BOOKMAKER = 60;
// The promos an account adds, kept at once at most.
export const MAX_OWN = 300;
// A promo whose end has passed stays this long, then is forgotten.
export const KEEP_AFTER_END_MS = 14 * 24 * 60 * 60 * 1000;

// Printable text: control characters gone, line breaks kept where asked.
const clean = (value: string, max: number, lines = false) =>
  (lines ? value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ") : value.replace(/[\u0000-\u001f\u007f]+/g, " "))
    .trim()
    .slice(0, max);

// An address the page may link to: http(s) only, never "javascript:".
export function safeUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

// The body of a POST, or null when it is not a promo.
export function parseNewPromo(input: unknown): NewPromo | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const { bookmaker, title, details, url, endsAt } = input as Record<string, unknown>;
  if (typeof bookmaker !== "string" || typeof title !== "string") return null;
  if (details !== undefined && typeof details !== "string") return null;
  if (url !== undefined && url !== null && url !== "" && typeof url !== "string") return null;
  if (endsAt !== undefined && endsAt !== null && endsAt !== "" && typeof endsAt !== "string") return null;
  const b = clean(bookmaker, MAX_BOOKMAKER);
  const t = clean(title, MAX_TITLE);
  if (!b || !t) return null;
  let link: string | null = null;
  if (typeof url === "string" && url.trim()) {
    link = safeUrl(url);
    if (!link) return null;
  }
  let ends: string | null = null;
  if (typeof endsAt === "string" && endsAt.trim()) {
    const time = Date.parse(endsAt);
    if (!Number.isFinite(time)) return null;
    ends = new Date(time).toISOString();
  }
  return { bookmaker: b, title: t, details: typeof details === "string" ? clean(details, MAX_DETAILS, true) : "", url: link, endsAt: ends };
}

// The promos an account sees: its own and the site's, the open ones first
// (soonest end first), then the taken ones.
export function listPromos(db: DatabaseSync, userId: string): Promo[] {
  const rows = db
    .prepare(
      `SELECT p.id, p.source, p.bookmaker, p.title, p.details, p.url, p.ends_at AS endsAt, p.found_at AS foundAt,
              p.owner_id IS NOT NULL AS mine, t.taken_at AS takenAt
       FROM promos p LEFT JOIN user_promo_taken t ON t.promo_id = p.id AND t.user_id = @user
       WHERE p.owner_id IS NULL OR p.owner_id = @user
       ORDER BY t.taken_at IS NOT NULL, p.ends_at IS NULL, p.ends_at, p.found_at DESC, p.id DESC`
    )
    .all({ user: userId }) as unknown as (Omit<Promo, "mine"> & { mine: number })[];
  return rows.map((r) => ({ ...r, mine: r.mine === 1 }));
}

// The new promo's id, or null when the account already keeps MAX_OWN.
export function addPromo(db: DatabaseSync, userId: string, promo: NewPromo, now = new Date()): number | null {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM promos WHERE owner_id = ?").get(userId) as { n: number };
  if (n >= MAX_OWN) return null;
  const result = db
    .prepare(
      `INSERT INTO promos (owner_id, source, bookmaker, title, details, url, ends_at, found_at)
       VALUES (?, 'manual', ?, ?, ?, ?, ?, ?)`
    )
    .run(userId, promo.bookmaker, promo.title, promo.details, promo.url, promo.endsAt, now.toISOString());
  return Number(result.lastInsertRowid);
}

// An account's own promo only; false when it is not one.
export function deletePromo(db: DatabaseSync, userId: string, id: number): boolean {
  return db.prepare("DELETE FROM promos WHERE id = ? AND owner_id = ?").run(id, userId).changes > 0;
}

// False when the account cannot see the promo.
export function setPromoTaken(db: DatabaseSync, userId: string, id: number, taken: boolean, now = new Date()): boolean {
  const visible = db.prepare("SELECT 1 FROM promos WHERE id = ? AND (owner_id IS NULL OR owner_id = ?)").get(id, userId);
  if (!visible) return false;
  if (taken) {
    db.prepare("INSERT INTO user_promo_taken (user_id, promo_id, taken_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").run(
      userId,
      id,
      now.toISOString()
    );
  } else {
    db.prepare("DELETE FROM user_promo_taken WHERE user_id = ? AND promo_id = ?").run(userId, id);
  }
  return true;
}

// Forgets the promos ended long ago (and their marks with them).
export function purgePromos(db: DatabaseSync, now = new Date()): void {
  db.prepare("DELETE FROM promos WHERE ends_at IS NOT NULL AND ends_at < ?").run(new Date(now.getTime() - KEEP_AFTER_END_MS).toISOString());
}
