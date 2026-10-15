import { DatabaseSync } from "node:sqlite";
import { Express } from "express";
import { ListingOptions } from "../../src/db/repository";
import { createServer as createRawServer, ServerOptions } from "../../src/api/server";
import { createSession, createUser } from "../../src/auth/store";
import { testAuth, withCookie } from "../auth/helpers";

// createServer for the data routes' tests: the app, with a signed-in user's
// cookie on every request. Who may not get in is tests/api/protection.test.ts.
export function createServer(db: DatabaseSync, listing: ListingOptions = {}, options: Omit<ServerOptions, "auth"> = {}): Express {
  const t = testAuth();
  const cookie = syncCookie(t);
  return withCookie(createRawServer(db, listing, { ...options, auth: t.auth }), cookie);
}

function syncCookie(t: ReturnType<typeof testAuth>): string {
  const user = createUser(t.auth.db, { email: "ada@example.com", passwordHash: "x", verified: true }, t.auth.now());
  return `__Host-session=${createSession(t.auth.db, user.id, {}, t.auth.now())}`;
}
