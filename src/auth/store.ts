import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { hashToken, newToken } from "./tokens";

export type Role = "user" | "admin";
export type TokenType = "verify_email" | "reset_password";

export interface User {
  id: string;
  email: string;
  role: Role;
  status: "active" | "disabled";
  emailVerifiedAt: string | null;
}

interface UserRow {
  id: string;
  email: string;
  role: Role;
  status: "active" | "disabled";
  email_verified_at: string | null;
  password_hash: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
// A session ends after a week without use, and a month after login whatever
// its use (the OWASP idle and absolute timeouts).
export const SESSION_IDLE_MS = 7 * DAY_MS;
export const SESSION_ABSOLUTE_MS = 30 * DAY_MS;
export const TOKEN_TTL_MS: Record<TokenType, number> = {
  verify_email: DAY_MS,
  reset_password: 60 * 60 * 1000,
};
// last_seen_at is rewritten at most this often: a page load makes several
// requests and each would write otherwise.
const TOUCH_EVERY_MS = 10 * 60 * 1000;
const EVENTS_KEPT_MS = 90 * DAY_MS;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const toUser = (row: UserRow): User => ({
  id: row.id,
  email: row.email,
  role: row.role,
  status: row.status,
  emailVerifiedAt: row.email_verified_at,
});

export function findUserByEmail(db: DatabaseSync, email: string): (User & { passwordHash: string }) | null {
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(normalizeEmail(email)) as UserRow | undefined;
  return row ? { ...toUser(row), passwordHash: row.password_hash } : null;
}

export function findUserById(db: DatabaseSync, id: string): User | null {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  return row ? toUser(row) : null;
}

export function createUser(
  db: DatabaseSync,
  { email, passwordHash, role = "user", verified = false }: { email: string; passwordHash: string; role?: Role; verified?: boolean },
  now = new Date()
): User {
  const id = randomUUID();
  const at = now.toISOString();
  db.prepare(
    `INSERT INTO users (id, email, email_verified_at, password_hash, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, normalizeEmail(email), verified ? at : null, passwordHash, role, at, at);
  return findUserById(db, id) as User;
}

export function setPasswordHash(db: DatabaseSync, userId: string, passwordHash: string, now = new Date()): void {
  db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(passwordHash, now.toISOString(), userId);
}

export function markEmailVerified(db: DatabaseSync, userId: string, now = new Date()): void {
  const at = now.toISOString();
  db.prepare("UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?").run(at, at, userId);
}

export function setRole(db: DatabaseSync, userId: string, role: Role): void {
  db.prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ?").run(role, new Date().toISOString(), userId);
}

export function setStatus(db: DatabaseSync, userId: string, status: User["status"]): void {
  db.prepare("UPDATE users SET status = ?, updated_at = ? WHERE id = ?").run(status, new Date().toISOString(), userId);
}

// What the administration page shows about an account. Never the password hash.
export interface AdminUser {
  id: string;
  email: string;
  role: Role;
  status: User["status"];
  emailVerifiedAt: string | null;
  subscriptionStatus: "none" | "active";
  createdAt: string;
  lastLoginAt: string | null;
}

export function listUsers(db: DatabaseSync): AdminUser[] {
  const rows = db
    .prepare(
      `SELECT id, email, role, status, email_verified_at, subscription_status, created_at, last_login_at
       FROM users ORDER BY created_at DESC, email`
    )
    .all() as unknown as {
    id: string;
    email: string;
    role: Role;
    status: User["status"];
    email_verified_at: string | null;
    subscription_status: "none" | "active";
    created_at: string;
    last_login_at: string | null;
  }[];
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    emailVerifiedAt: row.email_verified_at,
    subscriptionStatus: row.subscription_status,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  }));
}

export function recordLogin(db: DatabaseSync, userId: string, now = new Date()): void {
  db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(now.toISOString(), userId);
}

// ---- Sessions ----

// Opens a session; returns the token for the cookie (never stored as is).
export function createSession(
  db: DatabaseSync,
  userId: string,
  { ip, userAgent }: { ip?: string; userAgent?: string } = {},
  now = new Date()
): string {
  const token = newToken();
  const at = now.toISOString();
  db.prepare(
    `INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(hashToken(token), userId, at, at, new Date(now.getTime() + SESSION_ABSOLUTE_MS).toISOString(), ip ?? null, userAgent?.slice(0, 300) ?? null);
  return token;
}

// The user of a live session: neither idle nor past its absolute end, and not
// disabled since. Slides the idle window.
export function findSessionUser(db: DatabaseSync, token: string, now = new Date()): User | null {
  const hash = hashToken(token);
  const row = db
    .prepare(
      `SELECT u.*, s.last_seen_at AS seen, s.expires_at AS expires
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`
    )
    .get(hash) as (UserRow & { seen: string; expires: string }) | undefined;
  if (!row) return null;
  const t = now.getTime();
  if (row.expires <= now.toISOString() || Date.parse(row.seen) + SESSION_IDLE_MS <= t || row.status !== "active") {
    return null;
  }
  if (Date.parse(row.seen) + TOUCH_EVERY_MS <= t) {
    db.prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?").run(now.toISOString(), hash);
  }
  return toUser(row);
}

export function deleteSession(db: DatabaseSync, token: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

export function deleteUserSessions(db: DatabaseSync, userId: string): void {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

// ---- Email and reset tokens ----

// A single-use token for `userId`; the user's earlier ones of that type stop
// working.
export function createAuthToken(db: DatabaseSync, userId: string, type: TokenType, now = new Date()): string {
  const token = newToken();
  db.prepare("DELETE FROM auth_tokens WHERE user_id = ? AND type = ?").run(userId, type);
  db.prepare("INSERT INTO auth_tokens (token_hash, user_id, type, created_at, expires_at) VALUES (?, ?, ?, ?, ?)").run(
    hashToken(token),
    userId,
    type,
    now.toISOString(),
    new Date(now.getTime() + TOKEN_TTL_MS[type]).toISOString()
  );
  return token;
}

// Whose token it is, if it is still good; nothing is spent.
export function peekAuthToken(db: DatabaseSync, token: string, type: TokenType, now = new Date()): string | null {
  const row = db
    .prepare("SELECT user_id FROM auth_tokens WHERE token_hash = ? AND type = ? AND used_at IS NULL AND expires_at > ?")
    .get(hashToken(token), type, now.toISOString()) as { user_id: string } | undefined;
  return row?.user_id ?? null;
}

// Uses the token up and returns its user, or null when unknown, of another
// type, expired or already used.
export function consumeAuthToken(db: DatabaseSync, token: string, type: TokenType, now = new Date()): string | null {
  const hash = hashToken(token);
  const row = db
    .prepare("SELECT user_id FROM auth_tokens WHERE token_hash = ? AND type = ? AND used_at IS NULL AND expires_at > ?")
    .get(hash, type, now.toISOString()) as { user_id: string } | undefined;
  if (!row) return null;
  const used = db.prepare("UPDATE auth_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL").run(now.toISOString(), hash);
  return Number(used.changes) === 1 ? row.user_id : null;
}

// ---- Audit trail and upkeep ----

export function recordEvent(db: DatabaseSync, type: string, userId: string | null, ip?: string, now = new Date()): void {
  db.prepare("INSERT INTO auth_events (user_id, type, ip, created_at) VALUES (?, ?, ?, ?)").run(userId, type, ip ?? null, now.toISOString());
}

// Forgets what has expired. Unverified accounts older than a week go too:
// whoever never confirmed the address does not hold it.
export function purgeExpired(db: DatabaseSync, now = new Date()): void {
  const at = now.toISOString();
  db.prepare("DELETE FROM sessions WHERE expires_at <= ? OR last_seen_at <= ?").run(at, new Date(now.getTime() - SESSION_IDLE_MS).toISOString());
  db.prepare("DELETE FROM auth_tokens WHERE expires_at <= ? OR used_at IS NOT NULL").run(at);
  db.prepare("DELETE FROM auth_events WHERE created_at <= ?").run(new Date(now.getTime() - EVENTS_KEPT_MS).toISOString());
  db.prepare("DELETE FROM users WHERE email_verified_at IS NULL AND created_at <= ?").run(new Date(now.getTime() - 7 * DAY_MS).toISOString());
}
