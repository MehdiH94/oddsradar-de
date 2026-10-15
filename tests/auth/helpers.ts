import { DatabaseSync } from "node:sqlite";
import express, { Express } from "express";
import { openAuthDb } from "../../src/auth/db";
import { AuthContext, createAuthContext } from "../../src/auth/context";
import { Mail, Mailer } from "../../src/auth/mailer";
import { hashPassword } from "../../src/auth/password";
import { createSession, createUser } from "../../src/auth/store";

// Cheap scrypt, so that a test doing a dozen logins stays fast.
export const TEST_COST = { N: 2 ** 10, r: 8, p: 1 };
export const PASSWORD = "correct horse battery";
export const SITE = "https://coteradar.test";

export interface TestAuth {
  auth: AuthContext;
  sent: Mail[];
  clock: { now: Date };
}

export function testAuth(): TestAuth {
  const sent: Mail[] = [];
  const mailer: Mailer = { send: async (mail) => void sent.push(mail) };
  const clock = { now: new Date("2026-10-10T10:00:00Z") };
  const auth = createAuthContext({
    db: openAuthDb(":memory:"),
    mailer,
    publicUrl: SITE,
    cost: TEST_COST,
    now: () => clock.now,
  });
  return { auth, sent, clock };
}

export async function addUser(db: DatabaseSync, email = "ada@example.com", opts: { verified?: boolean; role?: "user" | "admin" } = {}) {
  return createUser(db, { email, passwordHash: await hashPassword(PASSWORD, TEST_COST), verified: opts.verified ?? true, role: opts.role }, new Date("2026-10-10T09:00:00Z"));
}

// A session cookie header for a signed-in user.
export async function sessionCookie({ auth }: TestAuth, email = "ada@example.com"): Promise<string> {
  const user = await addUser(auth.db, email);
  const token = createSession(auth.db, user.id, {}, auth.now());
  return `__Host-session=${token}`;
}

// The app as seen by a signed-in browser: every request carries the cookie.
export function withCookie(app: Express, cookie: string): Express {
  const outer = express();
  outer.use((req, _res, next) => {
    req.headers.cookie = cookie;
    next();
  });
  outer.use(app);
  return outer;
}

export function linkIn(mail: Mail): string {
  return mail.text.match(/https?:\/\/\S+/)![0];
}
