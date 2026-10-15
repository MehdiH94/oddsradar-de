import { DatabaseSync } from "node:sqlite";
import { Mailer } from "./mailer";
import { createRateLimiter, RateLimiter } from "./rateLimit";
import { DEFAULT_COST, hashPassword, ScryptCost } from "./password";

// What the auth routes and middleware share. Built once by the web process
// (src/api/index.ts); a test builds one with a cheap hash and a fake mailer.
export interface AuthContext {
  db: DatabaseSync;
  mailer: Mailer;
  // The site's address, no trailing slash: where the emails' links point, and
  // the origin browsers' requests must come from.
  publicUrl: string;
  // Cookies marked Secure (and named __Host-): on whenever the site is https.
  secureCookies: boolean;
  limiter: RateLimiter;
  cost: ScryptCost;
  // A hash to verify against when an email has no account, so that "unknown
  // email" and "wrong password" take the same time.
  dummyHash(): Promise<string>;
  now(): Date;
}

export interface AuthOptions {
  db: DatabaseSync;
  mailer: Mailer;
  publicUrl: string;
  secureCookies?: boolean;
  limiter?: RateLimiter;
  cost?: ScryptCost;
  now?: () => Date;
}

export function createAuthContext(opts: AuthOptions): AuthContext {
  const publicUrl = opts.publicUrl.replace(/\/+$/, "");
  const cost = opts.cost ?? DEFAULT_COST;
  let dummy: Promise<string> | undefined;
  return {
    db: opts.db,
    mailer: opts.mailer,
    publicUrl,
    secureCookies: opts.secureCookies ?? publicUrl.startsWith("https://"),
    limiter: opts.limiter ?? createRateLimiter(),
    cost,
    dummyHash: () => (dummy ??= hashPassword("not-a-real-password", cost)),
    now: opts.now ?? (() => new Date()),
  };
}
