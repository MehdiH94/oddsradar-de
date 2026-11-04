import { describe, expect, it } from "vitest";
import request from "supertest";
import { openDb } from "../../src/db/client";
import { openAuthDb } from "../../src/auth/db";
import { createServer } from "../../src/api/server";
import { createUser } from "../../src/auth/store";
import {
  listTakenValueBets,
  MAX_TAKEN_VALUE_BETS,
  parseTakenValueBet,
  purgeTakenValueBets,
  saveTakenValueBet,
  TakenValueBet,
} from "../../src/auth/takenValueBets";
import { SITE, sessionCookie, testAuth } from "./helpers";

const NOW = new Date("2026-10-10T10:00:00Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();
const BET: TakenValueBet = {
  key: "gala-fener:1X2:2:twentybet",
  eventId: "gala-fener",
  startTime: at(90),
  label: "Galatasaray - Fenerbahçe, Ergebnis: Fenerbahçe",
  market: "1X2",
  selection: "2",
  bookmaker: "twentybet",
  price: 3.5,
  edge: 0.045,
};

describe("parseTakenValueBet", () => {
  it("keeps a valid body, its time written as the API writes it", () => {
    expect(parseTakenValueBet({ ...BET, startTime: "2026-10-10T11:30:00+00:00" }, NOW)).toEqual(BET);
  });

  it("refuses what is not a value bet", () => {
    for (const bad of [
      { ...BET, price: 1 },
      { ...BET, edge: 0 },
      { ...BET, edge: 2 },
      { ...BET, key: "" },
      { ...BET, key: "a\nb" },
      { ...BET, bookmaker: 3 },
      { ...BET, startTime: "soon" },
      { ...BET, startTime: at(-3 * 24 * 60) },
      [],
      null,
    ]) {
      expect(parseTakenValueBet(bad, NOW), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("the taken value bets", () => {
  function setup() {
    const db = openAuthDb(":memory:");
    const ada = createUser(db, { email: "ada@example.com", passwordHash: "x", verified: true }, NOW);
    const bob = createUser(db, { email: "bob@example.com", passwordHash: "x", verified: true }, NOW);
    return { db, ada, bob };
  }

  it("keeps each account's own, the price and edge it was first taken at", () => {
    const { db, ada, bob } = setup();
    saveTakenValueBet(db, ada.id, BET, NOW);
    saveTakenValueBet(db, ada.id, { ...BET, price: 3.2, edge: 0.01 }, NOW);
    expect(listTakenValueBets(db, ada.id)).toEqual([BET]);
    expect(listTakenValueBets(db, bob.id)).toEqual([]);
  });

  it("keeps so many per account at most", () => {
    const { db, ada } = setup();
    for (let i = 0; i < MAX_TAKEN_VALUE_BETS; i++) expect(saveTakenValueBet(db, ada.id, { ...BET, key: `k${i}` }, NOW)).toBe(true);
    expect(saveTakenValueBet(db, ada.id, { ...BET, key: "one more" }, NOW)).toBe(false);
    expect(saveTakenValueBet(db, ada.id, { ...BET, key: "k0" }, NOW)).toBe(true);
  });

  it("forgets them two days after the match, and with the account", () => {
    const { db, ada, bob } = setup();
    saveTakenValueBet(db, ada.id, BET, NOW);
    saveTakenValueBet(db, bob.id, BET, NOW);
    purgeTakenValueBets(db, new Date(Date.parse(at(90 + 47 * 60))));
    expect(listTakenValueBets(db, ada.id)).toHaveLength(1);
    db.prepare("DELETE FROM users WHERE id = ?").run(bob.id);
    expect(db.prepare("SELECT COUNT(*) AS n FROM user_taken_value_bets").get()).toEqual({ n: 1 });
    purgeTakenValueBets(db, new Date(Date.parse(at(90 + 49 * 60))));
    expect(listTakenValueBets(db, ada.id)).toEqual([]);
  });
});

describe("/api/taken-value-bets", () => {
  function setup() {
    const t = testAuth();
    const odds = openDb(":memory:");
    const app = createServer(odds, {}, { auth: t.auth });
    const send = (method: "put" | "delete", cookie: string, body: unknown) =>
      request(app)[method]("/api/taken-value-bets").set({ Origin: SITE, Cookie: cookie }).send(body as object);
    const get = (cookie: string) => request(app).get("/api/taken-value-bets").set("Cookie", cookie);
    const bet = { ...BET, startTime: new Date(t.clock.now.getTime() + 90 * 60_000).toISOString() };
    return { ...t, odds, app, send, get, bet };
  }

  it("needs an account", async () => {
    const { app } = setup();
    expect((await request(app).get("/api/taken-value-bets")).status).toBe(401);
  });

  it("marks a value bet taken and takes the mark off", async () => {
    const t = setup();
    const cookie = await sessionCookie(t);
    expect((await t.send("put", cookie, t.bet)).status).toBe(204);
    expect((await t.get(cookie)).body.taken).toEqual([t.bet]);
    expect((await t.send("delete", cookie, { key: BET.key })).status).toBe(204);
    expect((await t.get(cookie)).body.taken).toEqual([]);
  });

  it("gives a started value bet its closing price, the last read before kick-off", async () => {
    const t = setup();
    const cookie = await sessionCookie(t);
    await t.send("put", cookie, t.bet);
    const start = t.bet.startTime;
    t.odds.exec("INSERT INTO bookmakers (id, name) VALUES ('twentybet', '20bet')");
    t.odds.prepare("INSERT INTO events (id, sport, competition, start_time, participants) VALUES (?, 'football', 'Süper Lig', ?, '[]')").run(BET.eventId, start);
    t.odds
      .prepare("INSERT INTO event_bookmaker_odds (event_id, bookmaker_id, market, selection, price, scraped_at) VALUES (?, 'twentybet', '1X2', '2', 3.3, ?)")
      .run(BET.eventId, new Date(Date.parse(start) - 5 * 60_000).toISOString());
    expect((await t.get(cookie)).body.taken[0]).not.toHaveProperty("closing");
    t.clock.now = new Date(Date.parse(start) + 60_000);
    expect((await t.get(cookie)).body.taken[0].closing).toBe(3.3);
  });

  it("refuses a body that is not a taken value bet, and a request from another site", async () => {
    const t = setup();
    const cookie = await sessionCookie(t);
    expect((await t.send("put", cookie, { ...t.bet, edge: "big" })).status).toBe(400);
    expect((await t.send("delete", cookie, { key: 3 })).status).toBe(400);
    const foreign = await request(t.app).put("/api/taken-value-bets").set({ Origin: "https://evil.test", Cookie: cookie }).send(t.bet);
    expect(foreign.status).toBe(403);
    expect((await t.get(cookie)).body.taken).toEqual([]);
  });
});
