import { describe, expect, it } from "vitest";
import request from "supertest";
import { openDb } from "../../src/db/client";
import { migrate, openAuthDb } from "../../src/auth/db";
import { createServer } from "../../src/api/server";
import { Preferences, getPreferences, savePreferences } from "../../src/auth/preferences";
import { createUser } from "../../src/auth/store";
import { MAX_FREEBET, Wallet, getWallet, parseWallet, saveWallet } from "../../src/freebets/wallet";
import { SITE, sessionCookie, testAuth } from "../auth/helpers";

const WALLET: Wallet = { leovegas: 25, merkurbets: 30.5 };

describe("parseWallet", () => {
  it("keeps a valid wallet as it is", () => {
    expect(parseWallet(WALLET)).toEqual(WALLET);
  });

  it("rounds each amount to the cent", () => {
    expect(parseWallet({ leovegas: 0.1 + 0.2, merkurbets: 12.349 })).toEqual({ leovegas: 0.3, merkurbets: 12.35 });
    expect(parseWallet({ merkurbets: 12.341 })).toEqual({ merkurbets: 12.34 });
  });

  it("drops the zero amounts and the unknown bookmakers, and lists the rest in the site's order", () => {
    const parsed = parseWallet({ merkurbets: 5, nope: 9, leovegas: 2 });
    expect(parsed).toEqual({ leovegas: 2, merkurbets: 5 });
    expect(Object.keys(parsed!)).toEqual(["leovegas", "merkurbets"]);
    expect(parseWallet({ merkurbets: 5, leovegas: 0 })).toEqual({ merkurbets: 5 });
  });

  it("drops an amount that rounds to nothing", () => {
    expect(parseWallet({ leovegas: 0.004 })).toEqual({});
  });

  it("accepts an empty wallet: a freebet account with nothing in it", () => {
    expect(parseWallet({})).toEqual({});
  });

  it("does not look at an unknown bookmaker, whatever it holds", () => {
    expect(parseWallet({ nope: "x", leovegas: 1 })).toEqual({ leovegas: 1 });
  });

  it("reads only the keys the body itself holds, never the ones it inherits", () => {
    expect(parseWallet(Object.create({ leovegas: 5 }))).toEqual({});
    expect(parseWallet(JSON.parse('{"__proto__": {"leovegas": 99}, "merkurbets": 3}'))).toEqual({ merkurbets: 3 });
  });

  it("accepts exactly the cap", () => {
    expect(parseWallet({ leovegas: MAX_FREEBET })).toEqual({ leovegas: MAX_FREEBET });
  });

  it.each([
    ["not an object", "25"],
    ["null", null],
    ["nothing", undefined],
    ["an array", []],
    ["an amount in text", { leovegas: "25" }],
    ["a null amount", { leovegas: null }],
    ["a boolean amount", { leovegas: true }],
    ["an object as an amount", { leovegas: {} }],
    ["a negative amount", { leovegas: -1 }],
    ["NaN", { leovegas: NaN }],
    ["Infinity", { leovegas: Infinity }],
    ["more than the cap", { leovegas: MAX_FREEBET + 1 }],
  ])("refuses %s", (_label, body) => {
    expect(parseWallet(body)).toBeNull();
  });
});

describe("the stored wallet", () => {
  function setup() {
    const db = openAuthDb(":memory:");
    const now = new Date("2026-10-11T10:00:00Z");
    const ada = createUser(db, { email: "ada@example.com", passwordHash: "x", verified: true }, now);
    const bob = createUser(db, { email: "bob@example.com", passwordHash: "x", verified: true }, now);
    return { db, now, ada, bob };
  }
  const rows = (db: ReturnType<typeof openAuthDb>) => (db.prepare("SELECT COUNT(*) AS n FROM user_freebets").get() as { n: number }).n;

  it("is empty until it is saved, then replaces what was there", () => {
    const { db, now, ada } = setup();
    expect(getWallet(db, ada.id)).toEqual({});
    saveWallet(db, ada.id, WALLET, now);
    expect(getWallet(db, ada.id)).toEqual(WALLET);
    saveWallet(db, ada.id, { leovegas: 10 }, now);
    expect(getWallet(db, ada.id)).toEqual({ leovegas: 10 });
    expect(rows(db)).toBe(1);
  });

  it("keeps whole cents, with the time it was saved", () => {
    const { db, now, ada } = setup();
    saveWallet(db, ada.id, { merkurbets: 12.35 }, now);
    expect(db.prepare("SELECT bookmaker, amount_cents, updated_at FROM user_freebets").all()).toEqual([
      { bookmaker: "merkurbets", amount_cents: 1235, updated_at: "2026-10-11T10:00:00.000Z" },
    ]);
  });

  it("is emptied by an empty wallet, or by zeros", () => {
    const { db, now, ada } = setup();
    saveWallet(db, ada.id, WALLET, now);
    saveWallet(db, ada.id, {}, now);
    expect(getWallet(db, ada.id)).toEqual({});
    saveWallet(db, ada.id, WALLET, now);
    saveWallet(db, ada.id, { leovegas: 0, merkurbets: 0 }, now);
    expect(getWallet(db, ada.id)).toEqual({});
    expect(rows(db)).toBe(0);
  });

  it("keeps each account's own", () => {
    const { db, now, ada, bob } = setup();
    saveWallet(db, ada.id, WALLET, now);
    expect(getWallet(db, bob.id)).toEqual({});
    saveWallet(db, bob.id, { merkurbets: 7 }, now);
    expect(getWallet(db, ada.id)).toEqual(WALLET);
    expect(getWallet(db, bob.id)).toEqual({ merkurbets: 7 });
  });

  it("goes with the account", () => {
    const { db, now, ada, bob } = setup();
    saveWallet(db, ada.id, WALLET, now);
    saveWallet(db, bob.id, { merkurbets: 7 }, now);
    db.prepare("DELETE FROM users WHERE id = ?").run(ada.id);
    expect(rows(db)).toBe(1);
    expect(getWallet(db, bob.id)).toEqual({ merkurbets: 7 });
  });

  it("never half-saves: a failure leaves the previous wallet, and the database usable", () => {
    const { db, now, ada } = setup();
    db.exec("CREATE TRIGGER fail_on_boom BEFORE INSERT ON user_freebets WHEN NEW.bookmaker = 'boom' BEGIN SELECT RAISE(ABORT, 'boom'); END");
    saveWallet(db, ada.id, { leovegas: 25 }, now);
    expect(() => saveWallet(db, ada.id, { merkurbets: 5, boom: 7 } as unknown as Wallet, now)).toThrow("boom");
    expect(getWallet(db, ada.id)).toEqual({ leovegas: 25 });
    // The failed transaction was rolled back: the next save is not nested in it.
    saveWallet(db, ada.id, { leovegas: 1 }, now);
    expect(getWallet(db, ada.id)).toEqual({ leovegas: 1 });
  });

  it("does not show a bookmaker the site no longer has", () => {
    const { db, now, ada } = setup();
    saveWallet(db, ada.id, { leovegas: 25 }, now);
    db.prepare("INSERT INTO user_freebets (user_id, bookmaker, amount_cents, updated_at) VALUES (?, 'gone', 500, 'x')").run(ada.id);
    expect(getWallet(db, ada.id)).toEqual({ leovegas: 25 });
  });

  it("is refused by the database itself when an amount is not positive", () => {
    const { db, ada } = setup();
    const insert = (cents: number) =>
      db.prepare("INSERT INTO user_freebets (user_id, bookmaker, amount_cents, updated_at) VALUES (?, 'leovegas', ?, 'x')").run(ada.id, cents);
    expect(() => insert(0)).toThrow();
    expect(() => insert(-5)).toThrow();
  });
});

describe("the freebets table in the accounts database", () => {
  it("is on the schema's version 12 (the feedback, the taken surebets, the promos and their payout and legs and the deposits and their limit came after), with its columns", () => {
    const db = openAuthDb(":memory:");
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 12 });
    const columns = (db.prepare("PRAGMA table_info(user_freebets)").all() as { name: string }[]).map((c) => c.name);
    expect(columns).toEqual(["user_id", "bookmaker", "amount_cents", "updated_at"]);
  });

  it("is added to a database at version 3, which keeps its accounts and their preferences", () => {
    const db = openAuthDb(":memory:");
    const now = new Date("2026-10-11T10:00:00Z");
    const ada = createUser(db, { email: "ada@example.com", passwordHash: "x", verified: true }, now);
    const prefs: Preferences = { sport: "tennis", sort: "start", bookmakers: ["leovegas"], players: false, favoriteSports: [] };
    savePreferences(db, ada.id, prefs, now);
    // The schema as it was before: no freebets table (nor the feedback, the taken surebets and the promos after it), version 3.
    db.exec("DROP TABLE user_deposit_limit");
    db.exec("DROP TABLE user_deposits");
    db.exec("DROP TABLE user_promo_reminded");
    db.exec("DROP TABLE user_promo_settings");
    db.exec("DROP TABLE user_promo_taken");
    db.exec("DROP TABLE promos");
    db.exec("DROP TABLE user_taken_surebets");
    db.exec("DROP TABLE feedback");
    db.exec("DROP TABLE user_freebets");
    db.exec("PRAGMA user_version = 3");

    migrate(db);

    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 12 });
    expect(db.prepare("SELECT email FROM users").all()).toEqual([{ email: "ada@example.com" }]);
    expect(getPreferences(db, ada.id)).toEqual(prefs);
    expect(getWallet(db, ada.id)).toEqual({});
    saveWallet(db, ada.id, WALLET, now);
    expect(getWallet(db, ada.id)).toEqual(WALLET);
    // And running it again changes nothing.
    migrate(db);
    expect(getWallet(db, ada.id)).toEqual(WALLET);
  });
});

describe("/api/freebets/wallet", () => {
  function setup() {
    const t = testAuth();
    const app = createServer(openDb(":memory:"), {}, { auth: t.auth });
    const put = (cookie: string, body: unknown, headers: Record<string, string> = {}) =>
      request(app).put("/api/freebets/wallet").set({ Origin: SITE, Cookie: cookie, ...headers }).send(body as object);
    const get = (cookie: string) => request(app).get("/api/freebets/wallet").set("Cookie", cookie);
    return { ...t, app, put, get };
  }

  it("needs an account", async () => {
    const { app } = setup();
    expect((await request(app).get("/api/freebets/wallet")).status).toBe(401);
    expect((await request(app).put("/api/freebets/wallet").set("Origin", SITE).send({ wallet: WALLET })).status).toBe(401);
  });

  it("answers an empty wallet, then what was saved", async () => {
    const t = setup();
    const cookie = await sessionCookie(t);
    expect((await t.get(cookie)).body).toEqual({ wallet: {} });
    const saved = await t.put(cookie, { wallet: WALLET });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ wallet: WALLET });
    const res = await t.get(cookie);
    expect(res.body).toEqual({ wallet: WALLET });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("answers the wallet as it stored it: cents rounded, zeros and unknown bookmakers left out", async () => {
    const t = setup();
    const cookie = await sessionCookie(t);
    const res = await t.put(cookie, { wallet: { merkurbets: 12.349, nope: 3, leovegas: 0 } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ wallet: { merkurbets: 12.35 } });
    expect((await t.get(cookie)).body).toEqual({ wallet: { merkurbets: 12.35 } });
  });

  it("replaces the whole wallet: a bookmaker left out goes back to nothing", async () => {
    const t = setup();
    const cookie = await sessionCookie(t);
    await t.put(cookie, { wallet: WALLET });
    await t.put(cookie, { wallet: { leovegas: 10 } });
    expect((await t.get(cookie)).body).toEqual({ wallet: { leovegas: 10 } });
    await t.put(cookie, { wallet: {} });
    expect((await t.get(cookie)).body).toEqual({ wallet: {} });
  });

  it("never shows one account the wallet of another", async () => {
    const t = setup();
    const ada = await sessionCookie(t, "ada@example.com");
    const bob = await sessionCookie(t, "bob@example.com");
    await t.put(ada, { wallet: WALLET });
    expect((await t.get(bob)).body).toEqual({ wallet: {} });
    await t.put(bob, { wallet: { merkurbets: 7 } });
    expect((await t.get(ada)).body).toEqual({ wallet: WALLET });
    expect((await t.get(bob)).body).toEqual({ wallet: { merkurbets: 7 } });
  });

  it.each([
    ["no wallet at all", {}],
    ["a wallet that is not an object", { wallet: "leovegas" }],
    ["a wallet that is a list", { wallet: [25] }],
    ["an amount in text", { wallet: { leovegas: "25" } }],
    ["a negative amount", { wallet: { leovegas: -5 } }],
    ["more than the cap", { wallet: { leovegas: MAX_FREEBET + 1 } }],
    ["a body that is a list", [{ leovegas: 25 }]],
  ])("refuses %s, and keeps the wallet it had", async (_label, body) => {
    const t = setup();
    const cookie = await sessionCookie(t);
    await t.put(cookie, { wallet: WALLET });
    const res = await t.put(cookie, body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid", message: "Ungültige Freebet-Beträge." });
    expect((await t.get(cookie)).body).toEqual({ wallet: WALLET });
  });

  it("refuses a body that is too big", async () => {
    const t = setup();
    const cookie = await sessionCookie(t);
    const res = await t.put(cookie, { wallet: WALLET, padding: "x".repeat(5000) });
    expect(res.status).toBe(413);
  });

  it("refuses a write from another site, or one that is not JSON", async () => {
    const t = setup();
    const cookie = await sessionCookie(t);
    expect((await t.put(cookie, { wallet: WALLET }, { Origin: "https://evil.example" })).status).toBe(403);
    const asText = await request(t.app).put("/api/freebets/wallet").set({ Origin: SITE, Cookie: cookie, "Content-Type": "text/plain" }).send(JSON.stringify({ wallet: WALLET }));
    expect(asText.status).toBe(403);
    expect((await t.get(cookie)).body).toEqual({ wallet: {} });
  });
});
