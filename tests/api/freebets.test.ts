import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { DatabaseSync } from "node:sqlite";
import { Express } from "express";
import { openDb } from "../../src/db/client";
import { upsertCanonicalEvents } from "../../src/db/repository";
import { saveReferenceOdds } from "../../src/db/reference";
import { createServer } from "../../src/api/server";
import { createSession } from "../../src/auth/store";
import { saveWallet, Wallet } from "../../src/freebets/wallet";
import { ComputeError, ComputePool, createInlinePool } from "../../src/freebets/pool";
import { PlanView } from "../../src/freebets/conversions";
import { addUser, testAuth, TestAuth, withCookie } from "../auth/helpers";
import { genMatches, marginsFor } from "../freebets/engine/helpers";
import { CanonicalEvent } from "../../src/types";

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600e3).toISOString();
const now = () => new Date().toISOString();

const BOOKMAKERS = ["winamax", "betclic", "unibet"];

// Matches priced by three bookmakers: football 1X2 and tennis winners, the margins of real bookmakers.
function events(count: number, seed: number): CanonicalEvent[] {
  return genMatches(count, marginsFor(3, seed), seed, { coverage: 1, share2way: 0.3 }).map((match, i) => {
    const football = match.outcomes === 3;
    return {
      id: match.id,
      sport: football ? "football" : "tennis",
      competition: football ? "Ligue 1" : "ATP",
      startTime: hoursFromNow(5 + i),
      participants: [`Home ${match.id}`, `Away ${match.id}`],
      byBookmaker: Object.fromEntries(
        BOOKMAKERS.map((bookmaker, b) => [
          bookmaker,
          (match.odds[b] as number[]).map((price, k) => ({ market: football ? "1X2" : "Vainqueur du match", selection: football ? ["1", "X", "2"][k] : ["1", "2"][k], price })),
        ])
      ),
    };
  });
}

// An account with a wallet, and the app as that account sees it.
async function signedIn(t: TestAuth, db: DatabaseSync, wallet: Wallet, options: Parameters<typeof createServer>[2] extends infer O ? Omit<NonNullable<O>, "auth"> : never = {}, email = "ada@example.com") {
  const user = await addUser(t.auth.db, email);
  saveWallet(t.auth.db, user.id, wallet, t.auth.now());
  const cookie = `__Host-session=${createSession(t.auth.db, user.id, {}, t.auth.now())}`;
  const raw = createServer(db, {}, { ...options, auth: t.auth });
  const app: Express = withCookie(raw, cookie);
  return { app, raw, user, cookie };
}

// What a plan must be, from its bets and the prices it shows alone: every combination of outcomes pays at
// least the cash, to the cent, and no bookmaker bets them all.
function expectConsistent(plan: PlanView, wallet: Wallet) {
  const cells = plan.matches.reduce<string[][]>((acc, match) => acc.flatMap((cell) => match.outcomes.map((o) => [...cell, o.label])), [[]]);
  const payoff = new Map(cells.map((cell) => [cell.join("|"), 0]));
  for (const group of plan.bookmakers) {
    expect(group.fb).toBe(wallet[group.bookmaker]);
    expect(group.used).toBeCloseTo(group.bets.reduce((s, b) => s + b.stake, 0), 9);
    expect(group.used).toBeLessThanOrEqual(wallet[group.bookmaker]! + 1e-9);
    // Not every combination at one bookmaker.
    expect(new Set(group.bets.map((b) => b.outcomes.join("|"))).size).toBeLessThan(cells.length);
    for (const bet of group.bets) {
      const price = bet.outcomes.reduce((p, label, m) => p * plan.matches[m].prices[group.bookmaker]![plan.matches[m].outcomes.findIndex((o) => o.label === label)], 1);
      expect(bet.odds).toBeCloseTo(price, 9);
      expect(bet.stake).toBeGreaterThanOrEqual(0.1);
      expect(Math.abs(bet.stake * 100 - Math.round(bet.stake * 100))).toBeLessThan(1e-6);
      expect(bet.gain).toBeCloseTo(bet.stake * (bet.odds - 1), 2);
      expect(bet.label).toBe(bet.outcomes.join(" + "));
      payoff.set(bet.outcomes.join("|"), payoff.get(bet.outcomes.join("|"))! + bet.stake * (bet.odds - 1));
    }
  }
  expect(Math.min(...payoff.values())).toBeCloseTo(plan.cash, 2);
  const used = plan.bookmakers.reduce((s, g) => s + g.used, 0);
  expect(plan.used).toBeCloseTo(used, 2);
  expect(plan.rate).toBeCloseTo(plan.cash / plan.used, 3);
  expect(plan.left).toBeCloseTo(Object.values(wallet).reduce((s, v) => s + v, 0) - plan.used, 2);
}

describe("GET /api/freebets/conversions", () => {
  let db: DatabaseSync;
  let t: TestAuth;
  beforeEach(() => {
    db = openDb(":memory:");
    t = testAuth();
  });
  const get = (app: Express, query: string) => request(app).get(`/api/freebets/conversions?${query}`);

  describe("between bookmakers", () => {
    const wallet = { winamax: 40, betclic: 25.5 };
    beforeEach(() => {
      upsertCanonicalEvents(db, events(12, 5));
    });

    it("gives the three best bets with no match in common, best cash first, each one consistent", async () => {
      const { app } = await signedIn(t, db, wallet);
      const res = await get(app, "mode=bookmakers&legs=1");
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.body).toMatchObject({ mode: "bookmakers", legs: 1, bookmakers: ["winamax", "betclic"], total: 65.5, reason: null, partial: false });
      const plans: PlanView[] = res.body.plans;
      expect(plans).toHaveLength(3);
      expect(plans.map((p) => p.rank)).toEqual([1, 2, 3]);
      expect(plans[0].cash).toBeGreaterThanOrEqual(plans[1].cash);
      expect(plans[1].cash).toBeGreaterThanOrEqual(plans[2].cash);
      const eventIds = plans.flatMap((p) => p.matches.map((m) => m.eventId));
      expect(new Set(eventIds).size).toBe(eventIds.length);
      for (const plan of plans) {
        expectConsistent(plan, wallet);
        expect(plan.cash).toBeGreaterThan(0);
        // Only the prices of the bookmakers holding freebets are shown.
        expect(Object.keys(plan.matches[0].prices).sort()).toEqual(["betclic", "winamax"]);
        expect(plan.oddsAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }
      expect(res.body.eligibleSports).toEqual(["football", "tennis"]);
      expect(res.body.computedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it.each([2, 3])("gives combos of %i matches, mixing sports, each one consistent", async (legs) => {
      const { app } = await signedIn(t, db, wallet);
      const res = await get(app, `mode=bookmakers&legs=${legs}`);
      expect(res.status).toBe(200);
      const plans: PlanView[] = res.body.plans;
      expect(plans.length).toBeGreaterThanOrEqual(1);
      for (const plan of plans) {
        expect(plan.matches).toHaveLength(legs);
        expectConsistent(plan, wallet);
      }
      const eventIds = plans.flatMap((p) => p.matches.map((m) => m.eventId));
      expect(new Set(eventIds).size).toBe(eventIds.length);
    });

    it("converts only the sports ticked, and lists the sports on offer whatever is ticked", async () => {
      const { app } = await signedIn(t, db, wallet);
      const tennis = await get(app, "mode=bookmakers&legs=1&sports=tennis");
      expect(tennis.body.eligibleSports).toEqual(["football", "tennis"]);
      for (const plan of tennis.body.plans as PlanView[]) expect(plan.matches.every((m) => m.sport === "tennis")).toBe(true);
      const none = await get(app, "mode=bookmakers&legs=1&sports=");
      expect(none.body).toMatchObject({ plans: [], reason: "no_match", eligibleSports: ["football", "tennis"] });
      const unknown = await get(app, "mode=bookmakers&legs=1&sports=curling");
      expect(unknown.body).toMatchObject({ plans: [], reason: "no_match" });
    });

    it("says why there is nothing to convert: no freebets, or freebets at one bookmaker only", async () => {
      const empty = await signedIn(t, db, {}, {}, "empty@example.com");
      expect((await get(empty.app, "mode=bookmakers&legs=2")).body).toMatchObject({ plans: [], bookmakers: [], total: 0, reason: "empty_wallet", eligibleSports: ["football", "tennis"] });
      const single = await signedIn(t, db, { betclic: 30 }, {}, "single@example.com");
      expect((await get(single.app, "mode=bookmakers&legs=1")).body).toMatchObject({ plans: [], bookmakers: ["betclic"], total: 30, reason: "single_bookmaker" });
    });

    it("never uses the prices of a bookmaker where the account holds no freebets", async () => {
      const { app } = await signedIn(t, db, wallet);
      const res = await get(app, "mode=bookmakers&legs=2");
      const used = new Set((res.body.plans as PlanView[]).flatMap((p) => p.bookmakers.map((g) => g.bookmaker)));
      expect(used.has("unibet" as never)).toBe(false);
    });

    it("leaves out the matches that have started, the stale prices and the races", async () => {
      upsertCanonicalEvents(db, [
        { id: "race", sport: "cycling", competition: "Tour", startTime: hoursFromNow(8), participants: ["Tour"], byBookmaker: { winamax: [{ market: "Vainqueur", selection: "A", price: 3 }], betclic: [{ market: "Vainqueur", selection: "A", price: 3.2 }] } },
        { id: "started", sport: "football", competition: "L1", startTime: hoursFromNow(-1), participants: ["X", "Y"], byBookmaker: { winamax: [{ market: "1X2", selection: "1", price: 2 }, { market: "1X2", selection: "X", price: 3 }, { market: "1X2", selection: "2", price: 4 }], betclic: [{ market: "1X2", selection: "1", price: 2 }, { market: "1X2", selection: "X", price: 3 }, { market: "1X2", selection: "2", price: 4 }] } },
      ]);
      const { app } = await signedIn(t, db, wallet);
      const res = await get(app, "mode=bookmakers&legs=1");
      expect(res.body.eligibleSports).toEqual(["football", "tennis"]);
      const ids = (res.body.plans as PlanView[]).flatMap((p) => p.matches.map((m) => m.eventId));
      expect(ids).not.toContain("race");
      expect(ids).not.toContain("started");
    });
  });

  describe("against the exchange", () => {
    // The mock-up's three matches, priced at Betclic and laid on the exchange.
    const picks = [
      { id: "brest", teams: ["Brest", "Auxerre"], sport: "football", pick: "2", back: 4.6, lay: 4.65, laySize: 11, start: 20 },
      { id: "augsburg", teams: ["Augsbourg", "Hambourg"], sport: "football", pick: "X", back: 3.9, lay: 3.95, laySize: 9, start: 30 },
      { id: "lille", teams: ["Lille", "Lens"], sport: "football", pick: "2", back: 3.85, lay: 3.9, laySize: 120, start: 25 },
    ];
    beforeEach(() => {
      upsertCanonicalEvents(
        db,
        picks.map((p) => ({
          id: p.id,
          sport: p.sport,
          competition: "Ligue 1",
          startTime: hoursFromNow(p.start),
          participants: p.teams,
          byBookmaker: {
            betclic: ["1", "X", "2"].map((selection) => ({ market: "1X2", selection, price: selection === p.pick ? p.back : 2.5 })),
            winamax: ["1", "X", "2"].map((selection) => ({ market: "1X2", selection, price: 2.4 })),
          },
        }))
      );
      for (const p of picks) {
        // Only the pick has money to lay.
        const outcome = (value: number, other: number) => Object.fromEntries(["1", "X", "2"].map((s) => [s, s === p.pick ? value : other]));
        saveReferenceOdds(db, p.id, { fair: outcome(3, 3), back: outcome(p.back, 2.4), lay: outcome(p.lay, 2.45), backSize: outcome(50, 50), laySize: outcome(p.laySize, 1), matched: 9000 }, now());
      }
    });

    it("chains the conversions of one bookmaker's freebets, each limited by the exchange's money", async () => {
      const { app } = await signedIn(t, db, { betclic: 30, winamax: 10 });
      const res = await get(app, "mode=exchange&bookmaker=betclic");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ mode: "exchange", bookmaker: "betclic", fb: 30, reason: null, eligibleSports: ["football"] });
      const chain = res.body.chain;
      expect(chain.steps.map((s: { eventId: string }) => s.eventId)).toEqual(["brest", "augsburg", "lille"]);
      expect(chain.steps.map((s: { label: string }) => s.label)).toEqual(["Auxerre", "Nul", "Lens"]);
      expect(chain.steps.map((s: { fb: number }) => s.fb)).toEqual([14.12, 12.17, 3.71]);
      expect(chain.steps.map((s: { cash: number }) => s.cash)).toEqual([10.67, 8.73, 2.65]);
      expect(chain.steps.map((s: { limited: boolean }) => s.limited)).toEqual([true, true, false]);
      expect(chain).toMatchObject({ converted: 30, leftover: 0, liability: 74.62 });
      expect(chain.cash).toBeCloseTo(22.05, 9);
      expect(chain.steps[0]).toMatchObject({ participants: ["Brest", "Auxerre"], market: "1X2", selection: "2", back: 4.6, lay: 4.65, laySize: 11, layStake: 11 });
    });

    it("converts a bookmaker's freebets only, whatever else the account holds", async () => {
      const { app } = await signedIn(t, db, { betclic: 12, winamax: 100 });
      const res = await get(app, "mode=exchange&bookmaker=betclic");
      expect(res.body.fb).toBe(12);
      expect(res.body.chain.converted).toBeLessThanOrEqual(12);
      expect(res.body.chain.steps[0].fb).toBeCloseTo(12, 9);
      expect(res.body.chain.steps).toHaveLength(1);
    });

    it("says when the bookmaker holds no freebets, or when nothing can be converted there", async () => {
      const { app } = await signedIn(t, db, { betclic: 30 });
      expect((await get(app, "mode=exchange&bookmaker=winamax")).body).toMatchObject({ chain: null, reason: "no_freebets", fb: 0 });
      expect((await get(app, "mode=exchange&bookmaker=betclic&sports=tennis")).body).toMatchObject({ chain: null, reason: "no_match", eligibleSports: ["football"] });
    });
  });

  describe("the request", () => {
    it.each(["", "mode=nope", "mode=bookmakers&legs=4", "mode=exchange", "mode=exchange&bookmaker=nobody", "mode=bookmakers&sports=a&sports=b"])("refuses %j", async (query) => {
      const { app } = await signedIn(t, db, { betclic: 30 });
      const res = await get(app, query);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: "invalid", message: expect.any(String) });
    });

    it("reads the wallet of the account, never one from the request", async () => {
      upsertCanonicalEvents(db, events(12, 5));
      const rich = await signedIn(t, db, { winamax: 40, betclic: 25.5 });
      const poor = await signedIn(t, db, { winamax: 10, betclic: 10 }, {}, "grace@example.com");
      const query = "mode=bookmakers&legs=1&wallet=%7B%22winamax%22%3A9999%7D&fb=9999";
      const a = await get(rich.app, query);
      const b = await get(poor.app, query);
      expect(a.body.total).toBe(65.5);
      expect(b.body.total).toBe(20);
      expect(a.body.plans[0].cash).toBeGreaterThan(b.body.plans[0].cash);
    });
  });

  describe("the calculation", () => {
    const wallet = { winamax: 40, betclic: 25.5 };
    const counting = (): ComputePool & { calls: number } => {
      const inner = createInlinePool();
      const pool = {
        calls: 0,
        run: (job: Parameters<ComputePool["run"]>[0]) => {
          pool.calls++;
          return inner.run(job);
        },
        close: inner.close,
      };
      return pool;
    };
    beforeEach(() => {
      upsertCanonicalEvents(db, events(12, 5));
    });

    it("is kept for the same wallet and settings, and made again for others", async () => {
      const pool = counting();
      const { app, user } = await signedIn(t, db, wallet, { freebetsPool: pool, freebetsCacheMs: 60_000 });
      const first = await get(app, "mode=bookmakers&legs=1");
      await get(app, "mode=bookmakers&legs=1");
      expect(pool.calls).toBe(1);
      await get(app, "mode=bookmakers&legs=2");
      expect(pool.calls).toBe(2);
      // The sports in another order are the same settings.
      await get(app, "mode=bookmakers&legs=1&sports=tennis,football");
      await get(app, "mode=bookmakers&legs=1&sports=football,tennis");
      expect(pool.calls).toBe(3);
      // A new wallet is a new calculation.
      saveWallet(t.auth.db, user.id, { winamax: 40, betclic: 30 }, t.auth.now());
      const changed = await get(app, "mode=bookmakers&legs=1");
      expect(pool.calls).toBe(4);
      expect(changed.body.total).toBe(70);
      expect(first.body.total).toBe(65.5);
    });

    it("is the same for two accounts that hold the same freebets", async () => {
      const pool = counting();
      const ada = await signedIn(t, db, wallet, { freebetsPool: pool, freebetsCacheMs: 60_000 });
      // Another account on the same site.
      const grace = await addUser(t.auth.db, "grace@example.com");
      saveWallet(t.auth.db, grace.id, wallet, t.auth.now());
      const graceCookie = `__Host-session=${createSession(t.auth.db, grace.id, {}, t.auth.now())}`;
      const a = await get(ada.app, "mode=bookmakers&legs=1");
      const b = await request(ada.raw).get("/api/freebets/conversions?mode=bookmakers&legs=1").set("Cookie", graceCookie);
      expect(pool.calls).toBe(1);
      expect(b.body).toEqual(a.body);
      // And a different wallet is not served theirs.
      saveWallet(t.auth.db, grace.id, { winamax: 5, betclic: 5 }, t.auth.now());
      const c = await request(ada.raw).get("/api/freebets/conversions?mode=bookmakers&legs=1").set("Cookie", graceCookie);
      expect(pool.calls).toBe(2);
      expect(c.body.total).toBe(10);
    });

    it("shares one calculation among identical requests made together, and reads the matches once", async () => {
      const pool = counting();
      const { app } = await signedIn(t, db, wallet, { freebetsPool: pool, freebetsCacheMs: 60_000 });
      const answers = await Promise.all([1, 2, 3].map(() => get(app, "mode=bookmakers&legs=1")));
      expect(pool.calls).toBe(1);
      expect(new Set(answers.map((a) => JSON.stringify(a.body))).size).toBe(1);
    });

    it("keeps nothing by default", async () => {
      const pool = counting();
      const { app } = await signedIn(t, db, wallet, { freebetsPool: pool });
      await get(app, "mode=bookmakers&legs=1");
      await get(app, "mode=bookmakers&legs=1");
      expect(pool.calls).toBe(2);
    });

    it("answers 503 when the calculation is busy or fails, keeps no failure, and logs a failure", async () => {
      let failure: ComputeError | null = new ComputeError("busy", "full");
      const pool: ComputePool = { run: async (job) => (failure ? Promise.reject(failure) : createInlinePool().run(job)), close: async () => {} };
      const { app } = await signedIn(t, db, wallet, { freebetsPool: pool, freebetsCacheMs: 60_000 });
      const busy = await get(app, "mode=bookmakers&legs=1");
      expect(busy.status).toBe(503);
      expect(busy.headers["retry-after"]).toBe("2");
      expect(busy.body).toMatchObject({ error: "busy", message: expect.any(String) });

      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      failure = new ComputeError("timeout", "slow");
      const slow = await get(app, "mode=bookmakers&legs=1");
      expect(slow.status).toBe(503);
      expect(slow.body.error).toBe("unavailable");
      expect(error).toHaveBeenCalledTimes(1);
      error.mockRestore();

      failure = null;
      expect((await get(app, "mode=bookmakers&legs=1")).status).toBe(200);
    });

    it("limits an account to 60 requests a minute, and to 2 different calculations at once", async () => {
      const { app } = await signedIn(t, db, wallet);
      for (let i = 0; i < 60; i++) expect((await get(app, "mode=bookmakers&legs=1")).status).toBe(200);
      const limited = await get(app, "mode=bookmakers&legs=1");
      expect(limited.status).toBe(429);
      expect(limited.body.error).toBe("rate_limited");
      expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);

      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      const slow: ComputePool = { run: async (job) => (await gate, createInlinePool().run(job)), close: async () => {} };
      const other = testAuth();
      const busy = await signedIn(other, db, wallet, { freebetsPool: slow });
      const three = ["legs=1", "legs=2", "legs=3"].map((legs) => get(busy.app, `mode=bookmakers&${legs}`).then((r) => r));
      await new Promise((resolve) => setTimeout(resolve, 100));
      release();
      const statuses = (await Promise.all(three)).map((r) => r.status).sort();
      expect(statuses).toEqual([200, 200, 429]);
    });
  });
});
