import { describe, expect, it } from "vitest";
import request from "supertest";
import { openDb } from "../../src/db/client";
import { openAuthDb } from "../../src/auth/db";
import { createServer } from "../../src/api/server";
import { createUser } from "../../src/auth/store";
import { getDeposits, LUGAS_BOOKMAKERS, lugasMonth, parseDeposits, saveDeposits } from "../../src/deposits/deposits";
import { SITE, sessionCookie, testAuth } from "../auth/helpers";

describe("lugasMonth", () => {
  it("is Germany's calendar month, not UTC's", () => {
    expect(lugasMonth(new Date("2026-11-15T12:00:00Z"))).toBe("2026-11");
    // 31/10 23:30 UTC is already 1 November in Berlin (CET, UTC+1).
    expect(lugasMonth(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11");
  });
});

describe("parseDeposits", () => {
  it("keeps the German-licensed bookmakers' amounts, to the cent, and leaves out 20bet", () => {
    expect(parseDeposits({ leovegas: 100, merkurbets: 49.999, twentybet: 300, unknown: 5 })).toEqual({ leovegas: 100, merkurbets: 50 });
    expect(LUGAS_BOOKMAKERS).not.toContain("twentybet");
  });

  it("refuses what is not deposits", () => {
    for (const input of [null, [], "x", { leovegas: -1 }, { leovegas: "10" }, { leovegas: 1e9 }]) {
      expect(parseDeposits(input), JSON.stringify(input)).toBeNull();
    }
  });
});

describe("the deposits store", () => {
  it("keeps this month's deposits and their total, and forgets them with the month", () => {
    const db = openAuthDb(":memory:");
    const ada = createUser(db, { email: "ada@example.com", passwordHash: "x", verified: true }, new Date("2026-11-01T10:00:00Z"));
    const nov = new Date("2026-11-02T10:00:00Z");
    saveDeposits(db, ada.id, { leovegas: 400, oddset: 240 }, nov);
    expect(getDeposits(db, ada.id, nov)).toEqual({ month: "2026-11", deposits: { leovegas: 400, oddset: 240 }, total: 640, limit: 1000 });
    expect(getDeposits(db, ada.id, new Date("2026-12-01T10:00:00Z"))).toEqual({ month: "2026-12", deposits: {}, total: 0, limit: 1000 });
  });
});

describe("/api/deposits", () => {
  function setup() {
    const t = testAuth();
    const app = createServer(openDb(":memory:"), {}, { auth: t.auth });
    const put = (cookie: string, body: unknown, origin = SITE) => request(app).put("/api/deposits").set({ Origin: origin, Cookie: cookie }).send(body as object);
    const get = (cookie: string) => request(app).get("/api/deposits").set("Cookie", cookie);
    return { ...t, app, put, get };
  }

  it("needs an account", async () => {
    const { app } = setup();
    expect((await request(app).get("/api/deposits")).status).toBe(401);
  });

  it("answers this month's deposits against the limit, then what was saved", async () => {
    const t = setup();
    const cookie = await sessionCookie(t);
    expect((await t.get(cookie)).body).toEqual({ month: "2026-10", deposits: {}, total: 0, limit: 1000 });
    const saved = await t.put(cookie, { deposits: { leovegas: 400, oddset: 240.5 } });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ month: "2026-10", deposits: { leovegas: 400, oddset: 240.5 }, total: 640.5, limit: 1000 });
    const res = await t.get(cookie);
    expect(res.body.total).toBe(640.5);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("refuses an amount that is not one, and a request from another site", async () => {
    const t = setup();
    const cookie = await sessionCookie(t);
    expect((await t.put(cookie, { deposits: { leovegas: -5 } })).status).toBe(400);
    expect((await t.put(cookie, { deposits: { leovegas: 5 } }, "https://evil.test")).status).toBe(403);
    expect((await t.get(cookie)).body.total).toBe(0);
  });
});
