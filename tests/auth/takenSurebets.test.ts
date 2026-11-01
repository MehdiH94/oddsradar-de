import { describe, expect, it } from "vitest";
import request from "supertest";
import { openDb } from "../../src/db/client";
import { openAuthDb } from "../../src/auth/db";
import { createServer } from "../../src/api/server";
import { createUser } from "../../src/auth/store";
import {
  dueReminders,
  listTakenSurebets,
  MAX_TAKEN,
  parseTakenSurebet,
  purgeTakenSurebets,
  saveTakenSurebet,
  TakenSurebet,
} from "../../src/auth/takenSurebets";
import { runSurebetReminders } from "../../src/auth/surebetReminders";
import { SITE, sessionCookie, testAuth } from "./helpers";

const NOW = new Date("2026-10-10T10:00:00Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();
const TAKEN: TakenSurebet = {
  key: "gala-fener:1X2:1@twentybet:back|X@admiralbet:back|2@exchange:lay",
  eventId: "gala-fener",
  startTime: at(90),
  label: "Galatasaray - Fenerbahçe, Ergebnis: Lay Fenerbahçe an der Börse 3,40",
  remind: true,
  payoutRate: 1.024,
  legs: [
    { market: "1X2", selection: "1", source: "twentybet", side: "back", price: 2.04 },
    { market: "1X2", selection: "X", source: "admiralbet", side: "back", price: 3.6 },
    { market: "1X2", selection: "2", source: "exchange", side: "lay", price: 3.4 },
  ],
};

describe("parseTakenSurebet", () => {
  it("keeps a valid body, its time written as the API writes it", () => {
    expect(parseTakenSurebet({ ...TAKEN, startTime: "2026-10-10T11:30:00Z" }, NOW)).toEqual({ ...TAKEN, startTime: at(90) });
  });

  it("keeps a payout a surebet can have, and none other", () => {
    for (const payoutRate of [1, 0.98, 1.6, Number.NaN, "1.02", undefined]) {
      expect(parseTakenSurebet({ ...TAKEN, payoutRate }, NOW)?.payoutRate, String(payoutRate)).toBeNull();
    }
    expect(parseTakenSurebet({ ...TAKEN, payoutRate: 1.5 }, NOW)?.payoutRate).toBe(1.5);
  });

  it("keeps legs that are legs, and none when one of them is not", () => {
    expect(parseTakenSurebet(TAKEN, NOW)?.legs).toEqual(TAKEN.legs);
    const leg = TAKEN.legs![0];
    for (const legs of [undefined, [], "x", [{ ...leg, side: "both" }], [{ ...leg, price: 1 }], [{ ...leg, price: "2" }], [{ ...leg, market: "" }], Array(7).fill(leg)]) {
      expect(parseTakenSurebet({ ...TAKEN, legs }, NOW)?.legs, JSON.stringify(legs)).toBeNull();
    }
  });

  it("puts a label on one line and caps it", () => {
    expect(parseTakenSurebet({ ...TAKEN, label: "a\nb" }, NOW)?.label).toBe("a b");
    expect(parseTakenSurebet({ ...TAKEN, label: "x".repeat(1000) }, NOW)?.label).toHaveLength(400);
  });

  it.each([
    ["not an object", "x"],
    ["no key", { ...TAKEN, key: "" }],
    ["a key with a line break", { ...TAKEN, key: "a\nb" }],
    ["a key too long", { ...TAKEN, key: "k".repeat(501) }],
    ["no time", { ...TAKEN, startTime: "soon" }],
    ["a match over long ago", { ...TAKEN, startTime: at(-3 * 24 * 60) }],
    ["a match too far ahead", { ...TAKEN, startTime: at(40 * 24 * 60) }],
    ["a reminder that is not a boolean", { ...TAKEN, remind: "yes" }],
  ])("refuses %s", (_label, body) => {
    expect(parseTakenSurebet(body, NOW)).toBeNull();
  });
});

describe("the taken surebets and their reminders", () => {
  function setup() {
    const db = openAuthDb(":memory:");
    const ada = createUser(db, { email: "ada@example.com", passwordHash: "x", verified: true }, NOW);
    const bob = createUser(db, { email: "bob@example.com", passwordHash: "x", verified: true }, NOW);
    return { db, ada, bob };
  }

  it("keeps each account's own, rewritten in place", () => {
    const { db, ada, bob } = setup();
    saveTakenSurebet(db, ada.id, TAKEN, NOW);
    // Saved again with the price moved since: the payout and the legs stay those it was taken at.
    const moved = TAKEN.legs!.map((l) => ({ ...l, price: l.price + 0.1 }));
    saveTakenSurebet(db, ada.id, { ...TAKEN, remind: false, payoutRate: 1.01, legs: moved }, NOW);
    expect(listTakenSurebets(db, ada.id)).toEqual([
      { key: TAKEN.key, remind: false, eventId: TAKEN.eventId, startTime: TAKEN.startTime, label: TAKEN.label, remindedAt: null, payoutRate: 1.024, legs: TAKEN.legs },
    ]);
    expect(listTakenSurebets(db, bob.id)).toEqual([]);
  });

  it("is due an hour before kick-off, not before, not once started", () => {
    const { db, ada } = setup();
    saveTakenSurebet(db, ada.id, TAKEN, NOW);
    expect(dueReminders(db, new Date(Date.parse(at(29))))).toEqual([]);
    expect(dueReminders(db, new Date(Date.parse(at(30))))).toEqual([
      { userId: ada.id, key: TAKEN.key, email: "ada@example.com", eventId: "gala-fener", startTime: at(90), label: TAKEN.label },
    ]);
    expect(dueReminders(db, new Date(Date.parse(at(90))))).toEqual([]);
  });

  it("is never due without the reminder asked for", () => {
    const { db, ada } = setup();
    saveTakenSurebet(db, ada.id, { ...TAKEN, remind: false }, NOW);
    expect(dueReminders(db, new Date(Date.parse(at(45))))).toEqual([]);
  });

  it("keeps so many per account at most", () => {
    const { db, ada } = setup();
    for (let i = 0; i < MAX_TAKEN; i++) expect(saveTakenSurebet(db, ada.id, { ...TAKEN, key: `k${i}` }, NOW)).toBe(true);
    expect(saveTakenSurebet(db, ada.id, { ...TAKEN, key: "one more" }, NOW)).toBe(false);
    // Changing one already kept is still allowed.
    expect(saveTakenSurebet(db, ada.id, { ...TAKEN, key: "k0", remind: false }, NOW)).toBe(true);
  });

  it("forgets them two days after the match, and with the account", () => {
    const { db, ada, bob } = setup();
    saveTakenSurebet(db, ada.id, TAKEN, NOW);
    saveTakenSurebet(db, bob.id, TAKEN, NOW);
    purgeTakenSurebets(db, new Date(Date.parse(at(90 + 47 * 60))));
    expect(listTakenSurebets(db, ada.id)).toHaveLength(1);
    db.prepare("DELETE FROM users WHERE id = ?").run(bob.id);
    expect(db.prepare("SELECT COUNT(*) AS n FROM user_taken_surebets").get()).toEqual({ n: 1 });
    purgeTakenSurebets(db, new Date(Date.parse(at(90 + 49 * 60))));
    expect(listTakenSurebets(db, ada.id)).toEqual([]);
  });

  it("sends each reminder once, to the account's address, with the match and what to check", async () => {
    const t = testAuth();
    const ada = createUser(t.auth.db, { email: "ada@example.com", passwordHash: "x", verified: true }, NOW);
    saveTakenSurebet(t.auth.db, ada.id, { ...TAKEN, startTime: new Date(t.clock.now.getTime() + 50 * 60_000).toISOString() }, NOW);
    expect(await runSurebetReminders(t.auth)).toBe(1);
    expect(await runSurebetReminders(t.auth)).toBe(0);
    expect(t.sent).toHaveLength(1);
    const [mail] = t.sent;
    expect(mail.to).toBe("ada@example.com");
    expect(mail.subject).toMatch(/^Börsenwette prüfen: Anstoß .+ · /);
    expect(mail.text).toContain(TAKEN.label);
    expect(mail.text).toContain("ob deine Wette dort vollständig gematcht ist");
    expect(mail.text).toContain(`${SITE}/odds?match=gala-fener`);
  });

  it("tries a reminder again the next minute when its mail fails", async () => {
    const t = testAuth();
    const ada = createUser(t.auth.db, { email: "ada@example.com", passwordHash: "x", verified: true }, NOW);
    saveTakenSurebet(t.auth.db, ada.id, { ...TAKEN, startTime: new Date(t.clock.now.getTime() + 50 * 60_000).toISOString() }, NOW);
    const send = t.auth.mailer.send;
    t.auth.mailer.send = async () => {
      throw new Error("SMTP down");
    };
    const errors = console.error;
    console.error = () => {};
    expect(await runSurebetReminders(t.auth)).toBe(0);
    console.error = errors;
    t.auth.mailer.send = send;
    expect(await runSurebetReminders(t.auth)).toBe(1);
  });
});

describe("/api/taken-surebets", () => {
  function setup() {
    const t = testAuth();
    const odds = openDb(":memory:");
    const app = createServer(odds, {}, { auth: t.auth });
    const send = (method: "put" | "delete", cookie: string, body: unknown) =>
      request(app)[method]("/api/taken-surebets").set({ Origin: SITE, Cookie: cookie }).send(body as object);
    const get = (cookie: string) => request(app).get("/api/taken-surebets").set("Cookie", cookie);
    const taken = { ...TAKEN, startTime: new Date(t.clock.now.getTime() + 90 * 60_000).toISOString() };
    return { ...t, odds, app, send, get, taken };
  }

  it("needs an account", async () => {
    const { app } = setup();
    expect((await request(app).get("/api/taken-surebets")).status).toBe(401);
  });

  it("marks a surebet taken, changes its reminder, and takes the mark off", async () => {
    const t = setup();
    const cookie = await sessionCookie(t);
    expect((await t.get(cookie)).body).toEqual({ taken: [] });
    expect((await t.send("put", cookie, t.taken)).status).toBe(204);
    expect((await t.get(cookie)).body).toEqual({ taken: [expect.objectContaining({ key: TAKEN.key, remind: true, eventId: TAKEN.eventId, label: TAKEN.label, remindedAt: null })] });
    expect((await t.send("put", cookie, { ...t.taken, remind: false })).status).toBe(204);
    expect((await t.get(cookie)).body).toEqual({ taken: [expect.objectContaining({ key: TAKEN.key, remind: false })] });
    expect((await t.send("delete", cookie, { key: TAKEN.key })).status).toBe(204);
    const res = await t.get(cookie);
    expect(res.body).toEqual({ taken: [] });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("never shows one account another's", async () => {
    const t = setup();
    const ada = await sessionCookie(t, "ada@example.com");
    const bob = await sessionCookie(t, "bob@example.com");
    await t.send("put", ada, t.taken);
    expect((await t.get(bob)).body).toEqual({ taken: [] });
    await t.send("delete", bob, { key: TAKEN.key });
    expect((await t.get(ada)).body.taken).toHaveLength(1);
  });

  it("gives each started surebet's backs at a bookmaker their closing price, the last read before kick-off", async () => {
    const t = setup();
    const cookie = await sessionCookie(t);
    await t.send("put", cookie, t.taken);
    const start = t.taken.startTime;
    const before = new Date(Date.parse(start) - 5 * 60_000).toISOString();
    const after = new Date(Date.parse(start) + 5 * 60_000).toISOString();
    t.odds.exec("INSERT INTO bookmakers (id, name) VALUES ('twentybet', '20bet'), ('admiralbet', 'Admiralbet')");
    t.odds.prepare("INSERT INTO events (id, sport, competition, start_time, participants) VALUES (?, 'football', 'Süper Lig', ?, '[]')").run(TAKEN.eventId, start);
    const price = t.odds.prepare("INSERT INTO event_bookmaker_odds (event_id, bookmaker_id, market, selection, price, scraped_at) VALUES (?, ?, '1X2', ?, ?, ?)");
    price.run(TAKEN.eventId, "twentybet", "1", 1.98, before);
    // Read again once the match had started: a live price, no closing price.
    price.run(TAKEN.eventId, "admiralbet", "X", 3.2, after);

    // Before kick-off: no closing price yet.
    expect((await t.get(cookie)).body.taken[0].legs[0]).not.toHaveProperty("closing");
    t.clock.now = new Date(Date.parse(start) + 60_000);
    const legs = (await t.get(cookie)).body.taken[0].legs;
    expect(legs.map((l: { closing: number | null }) => l.closing)).toEqual([1.98, null, null]);
  });

  it("refuses a body that is not a taken surebet, and a request from another site", async () => {
    const t = setup();
    const cookie = await sessionCookie(t);
    expect((await t.send("put", cookie, { ...t.taken, remind: "yes" })).status).toBe(400);
    expect((await t.send("delete", cookie, { key: 3 })).status).toBe(400);
    const foreign = await request(t.app).put("/api/taken-surebets").set({ Origin: "https://evil.test", Cookie: cookie }).send(t.taken);
    expect(foreign.status).toBe(403);
    expect((await t.get(cookie)).body).toEqual({ taken: [] });
  });
});
