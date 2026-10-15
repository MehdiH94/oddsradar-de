import { describe, expect, it } from "vitest";
import request from "supertest";
import { openDb } from "../../src/db/client";
import { openAuthDb } from "../../src/auth/db";
import { createServer } from "../../src/api/server";
import { getPreferences, parsePreferences, Preferences, savePreferences } from "../../src/auth/preferences";
import { createUser } from "../../src/auth/store";
import { SITE, sessionCookie, testAuth } from "./helpers";

const PREFS: Preferences = {
  sport: "tennis",
  sort: "start",
  bookmakers: ["leovegas", "merkurbets"],
  players: true,
  favoriteSports: ["tennis", "football"],
};

describe("parsePreferences", () => {
  it("keeps a valid body as it is", () => {
    expect(parsePreferences(PREFS)).toEqual(PREFS);
  });

  it("falls back to the default sort, and drops unknown bookmakers, in the filter's order", () => {
    const parsed = parsePreferences({ ...PREFS, sort: "random", bookmakers: ["merkurbets", "nope", "leovegas", "merkurbets"] });
    expect(parsed?.sort).toBe("trj");
    expect(parsed?.bookmakers).toEqual(["leovegas", "merkurbets"]);
  });

  it("keeps an empty selection of bookmakers: it means none, not the defaults", () => {
    expect(parsePreferences({ ...PREFS, bookmakers: [] })?.bookmakers).toEqual([]);
  });

  it("deduplicates the favorites and keeps three at most", () => {
    const parsed = parsePreferences({ ...PREFS, favoriteSports: ["a", "b", "a", "c", "d"] });
    expect(parsed?.favoriteSports).toEqual(["a", "b", "c"]);
  });

  it.each([
    ["not an object", "tennis"],
    ["null", null],
    ["an array", []],
    ["a sport that is not a name", { ...PREFS, sport: "../etc" }],
    ["an empty sport", { ...PREFS, sport: "" }],
    ["a sport too long", { ...PREFS, sport: "a".repeat(65) }],
    ["bookmakers that are not a list", { ...PREFS, bookmakers: "leovegas" }],
    ["players that is not a boolean", { ...PREFS, players: "yes" }],
    ["a favorite that is not a name", { ...PREFS, favoriteSports: ["<script>"] }],
    ["favorites that are not a list", { ...PREFS, favoriteSports: "football" }],
  ])("refuses %s", (_label, body) => {
    expect(parsePreferences(body)).toBeNull();
  });
});

describe("the stored preferences", () => {
  function setup() {
    const db = openAuthDb(":memory:");
    const now = new Date("2026-10-11T10:00:00Z");
    const ada = createUser(db, { email: "ada@example.com", passwordHash: "x", verified: true }, now);
    const bob = createUser(db, { email: "bob@example.com", passwordHash: "x", verified: true }, now);
    return { db, now, ada, bob };
  }

  it("has none until they are saved, then rewrites them in place", () => {
    const { db, now, ada } = setup();
    expect(getPreferences(db, ada.id)).toBeNull();
    savePreferences(db, ada.id, PREFS, now);
    expect(getPreferences(db, ada.id)).toEqual(PREFS);
    savePreferences(db, ada.id, { ...PREFS, sport: "football" }, now);
    expect(getPreferences(db, ada.id)?.sport).toBe("football");
    expect(db.prepare("SELECT COUNT(*) AS n FROM user_preferences").get()).toEqual({ n: 1 });
  });

  it("keeps each account's own", () => {
    const { db, now, ada, bob } = setup();
    savePreferences(db, ada.id, PREFS, now);
    expect(getPreferences(db, bob.id)).toBeNull();
  });

  it("goes with the account", () => {
    const { db, now, ada } = setup();
    savePreferences(db, ada.id, PREFS, now);
    db.prepare("DELETE FROM users WHERE id = ?").run(ada.id);
    expect(db.prepare("SELECT COUNT(*) AS n FROM user_preferences").get()).toEqual({ n: 0 });
  });

  it("is on the schema's version 4 (the subscriptions column and the freebets wallet came after)", () => {
    expect(openAuthDb(":memory:").prepare("PRAGMA user_version").get()).toEqual({ user_version: 4 });
  });
});

describe("/api/preferences", () => {
  function setup() {
    const t = testAuth();
    const app = createServer(openDb(":memory:"), {}, { auth: t.auth });
    const put = (cookie: string, body: unknown, headers: Record<string, string> = {}) =>
      request(app).put("/api/preferences").set({ Origin: SITE, Cookie: cookie, ...headers }).send(body as object);
    const get = (cookie: string) => request(app).get("/api/preferences").set("Cookie", cookie);
    return { ...t, app, put, get };
  }

  it("needs an account", async () => {
    const { app } = setup();
    expect((await request(app).get("/api/preferences")).status).toBe(401);
    expect((await request(app).put("/api/preferences").set("Origin", SITE).send(PREFS)).status).toBe(401);
  });

  it("answers null before anything is saved, then what was saved", async () => {
    const t = setup();
    const cookie = await sessionCookie(t);
    expect((await t.get(cookie)).body).toEqual({ preferences: null });
    expect((await t.put(cookie, PREFS)).status).toBe(204);
    const res = await t.get(cookie);
    expect(res.body).toEqual({ preferences: PREFS });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("never shows one account the preferences of another", async () => {
    const t = setup();
    const ada = await sessionCookie(t, "ada@example.com");
    const bob = await sessionCookie(t, "bob@example.com");
    await t.put(ada, PREFS);
    expect((await t.get(bob)).body).toEqual({ preferences: null });
    await t.put(bob, { ...PREFS, sport: "football", bookmakers: [] });
    expect((await t.get(ada)).body.preferences.sport).toBe("tennis");
    expect((await t.get(bob)).body.preferences).toMatchObject({ sport: "football", bookmakers: [] });
  });

  it("refuses a body that is not preferences", async () => {
    const t = setup();
    const cookie = await sessionCookie(t);
    const res = await t.put(cookie, { ...PREFS, sort: 3, sport: 12 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid");
    expect((await t.get(cookie)).body).toEqual({ preferences: null });
  });

  it("refuses a body that is too big", async () => {
    const t = setup();
    const cookie = await sessionCookie(t);
    const res = await t.put(cookie, { ...PREFS, padding: "x".repeat(5000) });
    expect(res.status).toBe(413);
  });

  it("refuses a write from another site", async () => {
    const t = setup();
    const cookie = await sessionCookie(t);
    expect((await t.put(cookie, PREFS, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await t.get(cookie)).body).toEqual({ preferences: null });
  });
});
