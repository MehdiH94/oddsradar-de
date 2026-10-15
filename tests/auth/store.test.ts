import { describe, expect, it } from "vitest";
import { openAuthDb } from "../../src/auth/db";
import {
  consumeAuthToken,
  createAuthToken,
  createSession,
  findSessionUser,
  listUsers,
  purgeExpired,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  setStatus,
  TOKEN_TTL_MS,
} from "../../src/auth/store";
import { addUser } from "./helpers";

const t0 = new Date("2026-10-10T10:00:00Z");
const after = (ms: number) => new Date(t0.getTime() + ms);

describe("sessions", () => {
  it("stores only a hash of the token", async () => {
    const db = openAuthDb(":memory:");
    const user = await addUser(db);
    const token = createSession(db, user.id, {}, t0);
    const rows = db.prepare("SELECT token_hash FROM sessions").all() as { token_hash: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toContain(token);
    expect(findSessionUser(db, token, t0)?.id).toBe(user.id);
    expect(findSessionUser(db, "not-a-token", t0)).toBeNull();
  });

  it("ends after a week idle, but use slides the window", async () => {
    const db = openAuthDb(":memory:");
    const user = await addUser(db);
    const token = createSession(db, user.id, {}, t0);
    const sixDays = 6 * 24 * 60 * 60 * 1000;
    expect(findSessionUser(db, token, after(sixDays))).not.toBeNull();
    expect(findSessionUser(db, token, after(sixDays + SESSION_IDLE_MS - 1000))).not.toBeNull();
    const idle = createSession(db, user.id, {}, t0);
    expect(findSessionUser(db, idle, after(SESSION_IDLE_MS))).toBeNull();
  });

  it("ends a month after login whatever its use", async () => {
    const db = openAuthDb(":memory:");
    const user = await addUser(db);
    const token = createSession(db, user.id, {}, t0);
    for (let day = 5; day < 30; day += 5) expect(findSessionUser(db, token, after(day * 24 * 3600 * 1000))).not.toBeNull();
    expect(findSessionUser(db, token, after(SESSION_ABSOLUTE_MS))).toBeNull();
  });

  it("refuses a disabled user's session", async () => {
    const db = openAuthDb(":memory:");
    const user = await addUser(db);
    const token = createSession(db, user.id, {}, t0);
    db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(user.id);
    expect(findSessionUser(db, token, t0)).toBeNull();
  });
});

describe("single-use tokens", () => {
  it("works once, for its type, before it expires", async () => {
    const db = openAuthDb(":memory:");
    const user = await addUser(db);
    const token = createAuthToken(db, user.id, "reset_password", t0);
    expect(consumeAuthToken(db, token, "verify_email", t0)).toBeNull();
    expect(consumeAuthToken(db, token, "reset_password", t0)).toBe(user.id);
    expect(consumeAuthToken(db, token, "reset_password", t0)).toBeNull();
    const late = createAuthToken(db, user.id, "reset_password", t0);
    expect(consumeAuthToken(db, late, "reset_password", after(TOKEN_TTL_MS.reset_password))).toBeNull();
  });

  it("replaces the previous token of the same type", async () => {
    const db = openAuthDb(":memory:");
    const user = await addUser(db);
    const first = createAuthToken(db, user.id, "verify_email", t0);
    const second = createAuthToken(db, user.id, "verify_email", t0);
    expect(consumeAuthToken(db, first, "verify_email", t0)).toBeNull();
    expect(consumeAuthToken(db, second, "verify_email", t0)).toBe(user.id);
  });
});

describe("purgeExpired", () => {
  it("forgets expired sessions and accounts never confirmed for a week", async () => {
    const db = openAuthDb(":memory:");
    const kept = await addUser(db, "kept@example.com");
    const stale = await addUser(db, "stale@example.com", { verified: false });
    createSession(db, kept.id, {}, t0);
    purgeExpired(db, after(8 * 24 * 60 * 60 * 1000));
    expect(db.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
    const emails = (db.prepare("SELECT email FROM users").all() as { email: string }[]).map((r) => r.email);
    expect(emails).toEqual([kept.email]);
    void stale;
  });
});

describe("the administration page's data", () => {
  it("starts every account without a subscription, and lists them newest first without the password", async () => {
    const db = openAuthDb(":memory:");
    const first = await addUser(db, "first@example.com");
    db.prepare("UPDATE users SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(first.id);
    const second = await addUser(db, "second@example.com", { verified: false });
    const users = listUsers(db);
    expect(users.map((u) => u.email)).toEqual(["second@example.com", "first@example.com"]);
    expect(users.every((u) => u.subscriptionStatus === "none")).toBe(true);
    expect(users[0]).toMatchObject({ id: second.id, emailVerifiedAt: null, status: "active", lastLoginAt: null });
    expect(Object.keys(users[0])).not.toContain("passwordHash");
  });

  it("refuses a subscription status the schema does not know", async () => {
    const db = openAuthDb(":memory:");
    const user = await addUser(db);
    expect(() => db.prepare("UPDATE users SET subscription_status = 'gold' WHERE id = ?").run(user.id)).toThrow();
  });

  it("blocks and unblocks", async () => {
    const db = openAuthDb(":memory:");
    const user = await addUser(db);
    const token = createSession(db, user.id, {}, t0);
    setStatus(db, user.id, "disabled");
    expect(findSessionUser(db, token, t0)).toBeNull();
    setStatus(db, user.id, "active");
    expect(findSessionUser(db, token, t0)?.id).toBe(user.id);
  });
});
