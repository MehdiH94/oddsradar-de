import { describe, expect, it } from "vitest";
import request from "supertest";
import { openDb } from "../../src/db/client";
import { openAuthDb } from "../../src/auth/db";
import { createServer } from "../../src/api/server";
import { createUser } from "../../src/auth/store";
import {
  addPromo,
  duePromoReminders,
  listPromos,
  MAX_OWN,
  NewPromo,
  parseNewPromo,
  promoRemindersOn,
  purgePromos,
  safeUrl,
  setPromoReminders,
  setPromoTaken,
} from "../../src/auth/promos";
import { runPromoReminders } from "../../src/auth/promoReminders";
import { SITE, sessionCookie, testAuth } from "./helpers";

const NOW = new Date("2026-10-10T10:00:00Z");
const PROMO: NewPromo = {
  bookmaker: "winamaxde",
  title: "100 % bis 100 € auf die erste Einzahlung",
  details: "Umsatz 5x zu Quoten ab 1,50.\nGültig 30 Tage.",
  url: "https://www.winamax.de/promotions",
  endsAt: "2026-10-20T22:00:00.000Z",
};

describe("parseNewPromo", () => {
  it("keeps a valid promo, its end written as the API writes it, its lines kept", () => {
    expect(parseNewPromo({ ...PROMO, endsAt: "2026-10-20T22:00:00Z" })).toEqual(PROMO);
  });

  it("takes a promo with a bookmaker and a title only", () => {
    expect(parseNewPromo({ bookmaker: "Stake", title: "Rakeback 10 %" })).toEqual({
      bookmaker: "Stake",
      title: "Rakeback 10 %",
      details: "",
      url: null,
      endsAt: null,
    });
    expect(parseNewPromo({ bookmaker: "Stake", title: "x", url: "", endsAt: "" })).toMatchObject({ url: null, endsAt: null });
  });

  it.each([
    ["not an object", "promo"],
    ["no bookmaker", { ...PROMO, bookmaker: " " }],
    ["no title", { ...PROMO, title: "" }],
    ["a javascript: link", { ...PROMO, url: "javascript:alert(1)" }],
    ["a link that is no address", { ...PROMO, url: "winamax" }],
    ["an end that is no date", { ...PROMO, endsAt: "bald" }],
    ["details that are not text", { ...PROMO, details: 3 }],
  ])("refuses %s", (_label, body) => {
    expect(parseNewPromo(body)).toBeNull();
  });

  it("links over http(s) only", () => {
    expect(safeUrl("https://t.me/stake")).toBe("https://t.me/stake");
    expect(safeUrl("data:text/html,x")).toBeNull();
  });
});

describe("the promos", () => {
  function setup() {
    const db = openAuthDb(":memory:");
    const ada = createUser(db, { email: "ada@example.com", passwordHash: "x", verified: true }, NOW);
    const bob = createUser(db, { email: "bob@example.com", passwordHash: "x", verified: true }, NOW);
    return { db, ada, bob };
  }

  it("shows an account its own and the site's, not another's; the open ones first, soonest end first", () => {
    const { db, ada, bob } = setup();
    const late = addPromo(db, ada.id, { ...PROMO, title: "late", endsAt: "2026-11-01T00:00:00.000Z" }, NOW)!;
    const soon = addPromo(db, ada.id, { ...PROMO, title: "soon" }, NOW)!;
    const open = addPromo(db, ada.id, { ...PROMO, title: "no end", endsAt: null }, NOW)!;
    addPromo(db, bob.id, { ...PROMO, title: "bob's" }, NOW);
    db.prepare("INSERT INTO promos (source, source_key, bookmaker, title, found_at) VALUES ('site', 'leovegas:1', 'leovegas', 'site''s', ?)").run(NOW.toISOString());
    setPromoTaken(db, ada.id, soon, true, NOW);

    const titles = listPromos(db, ada.id).map((p) => p.title);
    // Those without an end: the newest first.
    expect(titles).toEqual(["late", "site's", "no end", "soon"]);
    const [first] = listPromos(db, ada.id);
    expect(first).toMatchObject({ id: late, mine: true, takenAt: null, source: "manual" });
    expect(listPromos(db, ada.id).find((p) => p.title === "site's")).toMatchObject({ mine: false });
    expect(listPromos(db, ada.id).find((p) => p.id === soon)?.takenAt).toBe(NOW.toISOString());
    // Bob sees his own and the site's, and none of Ada's marks.
    expect(listPromos(db, bob.id).map((p) => [p.title, p.takenAt])).toEqual([
      ["bob's", null],
      ["site's", null],
    ]);
    expect(open).toBeGreaterThan(0);
  });

  it("never lets an account mark another's promo", () => {
    const { db, ada, bob } = setup();
    const id = addPromo(db, ada.id, PROMO, NOW)!;
    expect(setPromoTaken(db, bob.id, id, true, NOW)).toBe(false);
    expect(setPromoTaken(db, ada.id, 999, true, NOW)).toBe(false);
  });

  it("keeps so many own promos per account at most", () => {
    const { db, ada } = setup();
    for (let i = 0; i < MAX_OWN; i++) addPromo(db, ada.id, PROMO, NOW);
    expect(addPromo(db, ada.id, PROMO, NOW)).toBeNull();
  });

  it("forgets a promo two weeks after its end, with its marks, and those of an account that goes", () => {
    const { db, ada, bob } = setup();
    const id = addPromo(db, ada.id, PROMO, NOW)!;
    addPromo(db, ada.id, { ...PROMO, endsAt: null }, NOW);
    setPromoTaken(db, ada.id, id, true, NOW);
    purgePromos(db, new Date("2026-11-02T00:00:00Z"));
    expect(listPromos(db, ada.id)).toHaveLength(2);
    purgePromos(db, new Date("2026-11-04T00:00:00Z"));
    expect(listPromos(db, ada.id)).toHaveLength(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM user_promo_taken").get()).toEqual({ n: 0 });
    addPromo(db, bob.id, PROMO, NOW);
    db.prepare("DELETE FROM users WHERE id = ?").run(bob.id);
    expect(db.prepare("SELECT COUNT(*) AS n FROM promos WHERE owner_id IS NOT NULL").get()).toEqual({ n: 1 });
  });
});

describe("/api/promos", () => {
  function setup() {
    const t = testAuth();
    const app = createServer(openDb(":memory:"), {}, { auth: t.auth });
    const as = (cookie: string) => ({
      get: () => request(app).get("/api/promos").set("Cookie", cookie),
      add: (body: unknown) => request(app).post("/api/promos").set({ Origin: SITE, Cookie: cookie }).send(body as object),
      taken: (id: number | string, taken: unknown) =>
        request(app).put(`/api/promos/${id}/taken`).set({ Origin: SITE, Cookie: cookie }).send({ taken }),
      remove: (id: number | string) => request(app).delete(`/api/promos/${id}`).set({ Origin: SITE, Cookie: cookie }).send({}),
    });
    return { ...t, app, as };
  }

  it("needs an account", async () => {
    const { app } = setup();
    expect((await request(app).get("/api/promos")).status).toBe(401);
  });

  it("adds a promo, marks it taken and back, and takes it away", async () => {
    const t = setup();
    const ada = t.as(await sessionCookie(t));
    const added = await ada.add(PROMO);
    expect(added.status).toBe(201);
    const { id } = added.body as { id: number };

    let res = await ada.get();
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.promos).toEqual([{ id, source: "manual", ...PROMO, foundAt: t.clock.now.toISOString(), mine: true, takenAt: null }]);

    expect((await ada.taken(id, true)).status).toBe(204);
    expect((await ada.get()).body.promos[0].takenAt).toBe(t.clock.now.toISOString());
    expect((await ada.taken(id, false)).status).toBe(204);
    expect((await ada.get()).body.promos[0].takenAt).toBeNull();

    expect((await ada.remove(id)).status).toBe(204);
    res = await ada.get();
    expect(res.body.promos).toEqual([]);
  });

  it("tells whether the reminders are on, and turns them off and on", async () => {
    const t = setup();
    const cookie = await sessionCookie(t);
    const ada = t.as(cookie);
    expect((await ada.get()).body.remind).toBe(true);
    const settings = (body: unknown) => request(t.app).put("/api/promos/settings").set({ Origin: SITE, Cookie: cookie }).send(body as object);
    expect((await settings({ remind: "no" })).status).toBe(400);
    expect((await settings({ remind: false })).status).toBe(204);
    expect((await ada.get()).body.remind).toBe(false);
    expect((await settings({ remind: true })).status).toBe(204);
    expect((await ada.get()).body.remind).toBe(true);
  });

  it("keeps each account's promos to itself", async () => {
    const t = setup();
    const ada = t.as(await sessionCookie(t, "ada@example.com"));
    const bob = t.as(await sessionCookie(t, "bob@example.com"));
    const { id } = (await ada.add(PROMO)).body as { id: number };
    expect((await bob.get()).body.promos).toEqual([]);
    expect((await bob.taken(id, true)).status).toBe(404);
    expect((await bob.remove(id)).status).toBe(404);
    expect((await ada.get()).body.promos).toHaveLength(1);
  });

  it("refuses a promo without a bookmaker or with a bad link, a bad mark, and another site's request", async () => {
    const t = setup();
    const cookie = await sessionCookie(t);
    const ada = t.as(cookie);
    expect((await ada.add({ ...PROMO, bookmaker: "" })).status).toBe(400);
    expect((await ada.add({ ...PROMO, url: "javascript:alert(1)" })).status).toBe(400);
    expect((await ada.taken("abc", true)).status).toBe(400);
    expect((await ada.taken(1, "yes")).status).toBe(400);
    const foreign = await request(t.app).post("/api/promos").set({ Origin: "https://evil.test", Cookie: cookie }).send(PROMO);
    expect(foreign.status).toBe(403);
    expect((await ada.get()).body.promos).toEqual([]);
  });
});

describe("the e-mail the day before a promo ends", () => {
  const ends = (base: Date, hours: number) => new Date(base.getTime() + hours * 3600_000).toISOString();

  it("lists, by account, the open promos it sees that end within a day, not taken, for the accounts that did not turn it off", () => {
    const db = openAuthDb(":memory:");
    const ada = createUser(db, { email: "ada@example.com", passwordHash: "x", verified: true }, NOW);
    const bob = createUser(db, { email: "bob@example.com", passwordHash: "x", verified: true }, NOW);
    const soon = addPromo(db, ada.id, { ...PROMO, title: "soon", endsAt: ends(NOW, 20) }, NOW)!;
    const sooner = addPromo(db, ada.id, { ...PROMO, title: "sooner", endsAt: ends(NOW, 2) }, NOW)!;
    addPromo(db, ada.id, { ...PROMO, title: "later", endsAt: ends(NOW, 30) }, NOW);
    addPromo(db, ada.id, { ...PROMO, title: "ended", endsAt: ends(NOW, -1) }, NOW);
    addPromo(db, ada.id, { ...PROMO, title: "no end", endsAt: null }, NOW);
    const taken = addPromo(db, ada.id, { ...PROMO, title: "taken", endsAt: ends(NOW, 3) }, NOW)!;
    setPromoTaken(db, ada.id, taken, true, NOW);
    // The site's: everyone's.
    db.prepare("INSERT INTO promos (source, source_key, bookmaker, title, ends_at, found_at) VALUES ('site', 'k', 'leovegas', 'site''s', ?, ?)").run(
      ends(NOW, 5),
      NOW.toISOString()
    );
    const due = duePromoReminders(db, NOW);
    // Accounts in no particular order; each one's promos soonest end first.
    expect(due.map((d) => [d.email, d.promos.map((p) => p.title)]).sort()).toEqual([
      ["ada@example.com", ["sooner", "site's", "soon"]],
      ["bob@example.com", ["site's"]],
    ]);
    expect(due.find((d) => d.userId === ada.id)!.promos.map((p) => p.id)).toContain(soon);
    expect(due.find((d) => d.userId === ada.id)!.promos[0]).toEqual({ id: sooner, bookmaker: "winamaxde", title: "sooner", url: PROMO.url, endsAt: ends(NOW, 2) });

    // Bob turns them off; Ada stays on, as everyone by default.
    expect(promoRemindersOn(db, bob.id)).toBe(true);
    setPromoReminders(db, bob.id, false);
    expect(promoRemindersOn(db, bob.id)).toBe(false);
    expect(duePromoReminders(db, NOW).map((d) => d.email)).toEqual(["ada@example.com"]);
    setPromoReminders(db, bob.id, true);
    expect(duePromoReminders(db, NOW).map((d) => d.email).sort()).toEqual(["ada@example.com", "bob@example.com"]);
  });

  it("sends one e-mail per account, each promo once, and tries again when it fails", async () => {
    const t = testAuth();
    const ada = createUser(t.auth.db, { email: "ada@example.com", passwordHash: "x", verified: true }, NOW);
    addPromo(t.auth.db, ada.id, { ...PROMO, bookmaker: "Stake", title: "Rakeback 10 %", endsAt: ends(t.clock.now, 5) }, NOW);
    addPromo(t.auth.db, ada.id, { ...PROMO, endsAt: ends(t.clock.now, 10) }, NOW);

    const send = t.auth.mailer.send;
    t.auth.mailer.send = async () => {
      throw new Error("SMTP down");
    };
    const errors = console.error;
    console.error = () => {};
    expect(await runPromoReminders(t.auth)).toBe(0);
    console.error = errors;
    t.auth.mailer.send = send;

    expect(await runPromoReminders(t.auth)).toBe(1);
    expect(await runPromoReminders(t.auth)).toBe(0);
    expect(t.sent).toHaveLength(1);
    const [mail] = t.sent;
    expect(mail.to).toBe("ada@example.com");
    expect(mail.subject).toMatch(/^2 Promos enden bald · /);
    expect(mail.text).toContain("- Stake: Rakeback 10 % (endet ");
    expect(mail.text).toContain(`- winamaxde: ${PROMO.title} (endet `);
    expect(mail.text).toContain(`\n  ${PROMO.url}`);
    expect(mail.text).toContain(`${SITE}/promos`);

    // A new one ending soon: its own e-mail, the others not again.
    addPromo(t.auth.db, ada.id, { ...PROMO, bookmaker: "LeoVegas", title: "Quotenboost", endsAt: ends(t.clock.now, 3) }, NOW);
    expect(await runPromoReminders(t.auth)).toBe(1);
    expect(t.sent[1].subject).toMatch(/^Promo endet bald: LeoVegas · /);
    expect(t.sent[1].text).not.toContain("Rakeback");
  });
});
