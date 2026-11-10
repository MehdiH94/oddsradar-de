import { describe, expect, it } from "vitest";
import request from "supertest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/db/client";
import { createServer } from "../../src/api/server";
import { createSession, findUserById, listUsers } from "../../src/auth/store";
import { addUser, PASSWORD, SITE, testAuth, withCookie } from "./helpers";
import { recordBookmakerRead } from "../../src/db/bookmakerStatus";
import { saveSitePromos } from "../../src/promos/sitePromos";
import { runSitePromoAlerts } from "../../src/alerts/sitePromos";

async function setup() {
  const t = testAuth();
  const odds = openDb(":memory:");
  const raw = createServer(odds, {}, { auth: t.auth });
  const admin = await addUser(t.auth.db, "root@example.com", { role: "admin" });
  const member = await addUser(t.auth.db, "ada@example.com");
  const cookieFor = (id: string) => `__Host-session=${createSession(t.auth.db, id, {}, t.auth.now())}`;
  const asAdmin = withCookie(raw, cookieFor(admin.id));
  // JSON from this site, like the page's own fetch.
  const patch = (id: string, body: unknown, app = asAdmin) => request(app).patch(`/api/admin/users/${id}`).set({ Origin: SITE }).send(body as object);
  return { ...t, odds, raw, admin, member, cookieFor, asAdmin, patch };
}

describe("who may use the administration routes", () => {
  it("answers 401 to a visitor and 403 to an ordinary account", async () => {
    const { raw, member, cookieFor, auth } = await setup();
    expect((await request(raw).get("/api/admin/users")).status).toBe(401);
    const asMember = withCookie(raw, cookieFor(member.id));
    expect((await request(asMember).get("/api/admin/users")).status).toBe(403);
    const res = await request(asMember).patch(`/api/admin/users/${member.id}`).set({ Origin: SITE }).send({ role: "admin" });
    expect(res.status).toBe(403);
    expect(findUserById(auth.db, member.id)?.role).toBe("user");
  });
});

describe("GET /api/admin/users", () => {
  it("lists every account with its state, and never a password", async () => {
    const { asAdmin, admin, member, auth } = await setup();
    auth.db.prepare("INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES ('p', 'pending@example.com', 'secret-hash', ?, ?)").run(
      "2026-10-11T08:00:00.000Z",
      "2026-10-11T08:00:00.000Z"
    );
    const res = await request(asAdmin).get("/api/admin/users");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(JSON.stringify(res.body)).not.toMatch(/hash|secret/);
    const byEmail = Object.fromEntries(res.body.users.map((u: { email: string }) => [u.email, u]));
    expect(Object.keys(byEmail).sort()).toEqual(["ada@example.com", "pending@example.com", "root@example.com"]);
    expect(byEmail["root@example.com"]).toMatchObject({ id: admin.id, role: "admin", status: "active", subscriptionStatus: "none" });
    expect(byEmail["ada@example.com"]).toMatchObject({ id: member.id, role: "user", subscriptionStatus: "none" });
    expect(byEmail["ada@example.com"].emailVerifiedAt).not.toBeNull();
    expect(byEmail["pending@example.com"].emailVerifiedAt).toBeNull();
    // The newest account first.
    expect(res.body.users[0].email).toBe("pending@example.com");
  });
});

describe("PATCH /api/admin/users/:id", () => {
  it("blocks an account: it is signed out at once and cannot sign in again", async () => {
    const { raw, patch, member, cookieFor, auth } = await setup();
    const memberCookie = cookieFor(member.id);
    expect((await request(withCookie(raw, memberCookie)).get("/api/sports")).status).toBe(200);

    const res = await patch(member.id, { status: "disabled" });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: member.id, status: "disabled" });

    expect((await request(withCookie(raw, memberCookie)).get("/api/sports")).status).toBe(401);
    expect(auth.db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?").get(member.id)).toEqual({ n: 0 });
    const login = await request(raw).post("/api/auth/login").set({ Origin: SITE }).send({ email: member.email, password: PASSWORD });
    expect(login.status).toBe(403);
    expect(login.body.error).toBe("account_disabled");
    expect(listUsers(auth.db).find((u) => u.id === member.id)?.status).toBe("disabled");
  });

  it("unblocks an account, which can sign in again", async () => {
    const { raw, patch, member } = await setup();
    await patch(member.id, { status: "disabled" });
    expect((await patch(member.id, { status: "active" })).body.user.status).toBe("active");
    const login = await request(raw).post("/api/auth/login").set({ Origin: SITE }).send({ email: member.email, password: PASSWORD });
    expect(login.status).toBe(200);
  });

  it("makes an account an admin, and takes it back", async () => {
    const { raw, patch, member, cookieFor } = await setup();
    const asMember = withCookie(raw, cookieFor(member.id));
    expect((await request(asMember).get("/api/admin/users")).status).toBe(403);

    expect((await patch(member.id, { role: "admin" })).body.user.role).toBe("admin");
    expect((await request(asMember).get("/api/admin/users")).status).toBe(200);

    expect((await patch(member.id, { role: "user" })).body.user.role).toBe("user");
    expect((await request(asMember).get("/api/admin/users")).status).toBe(403);
  });

  it("keeps a trace of each change, with who made it", async () => {
    const { patch, member, admin, auth } = await setup();
    await patch(member.id, { status: "disabled" });
    await patch(member.id, { status: "active", role: "admin" });
    await patch(member.id, { role: "admin" }); // nothing changes: nothing to record
    const events = auth.db.prepare("SELECT type, user_id FROM auth_events WHERE type LIKE 'admin_%' ORDER BY id").all();
    expect(events).toEqual([
      { type: `admin_disable_user:${member.id}`, user_id: admin.id },
      { type: `admin_enable_user:${member.id}`, user_id: admin.id },
      { type: `admin_grant_admin:${member.id}`, user_id: admin.id },
    ]);
  });

  it("refuses to change one's own account", async () => {
    const { patch, admin, auth } = await setup();
    for (const body of [{ status: "disabled" }, { role: "user" }]) {
      const res = await patch(admin.id, body);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("self");
    }
    expect(findUserById(auth.db, admin.id)).toMatchObject({ role: "admin", status: "active" });
  });

  it("refuses an invalid change or an unknown account", async () => {
    const { patch, member, auth } = await setup();
    for (const body of [{}, { status: "banned" }, { role: "root" }, { status: 1 }, { role: null }, []]) {
      expect((await patch(member.id, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await patch("no-such-id", { status: "disabled" })).status).toBe(404);
    expect(findUserById(auth.db, member.id)).toMatchObject({ role: "user", status: "active" });
  });

  it("refuses a request that is not JSON from this site", async () => {
    const { asAdmin, member } = await setup();
    const foreign = await request(asAdmin).patch(`/api/admin/users/${member.id}`).set({ Origin: "https://evil.example" }).send({ status: "disabled" });
    expect(foreign.status).toBe(403);
    const form = await request(asAdmin).patch(`/api/admin/users/${member.id}`).set({ Origin: SITE }).type("form").send("status=disabled");
    expect(form.status).toBe(403);
  });
});

describe("GET /api/admin/bookmakers", () => {
  it("gives the admins each bookmaker's last read, and nobody else", async () => {
    const { asAdmin, raw, member, cookieFor, odds } = await setup();
    recordBookmakerRead(odds, "betway", { events: 950 });
    const res = await request(asAdmin).get("/api/admin/bookmakers");
    expect(res.status).toBe(200);
    expect(res.body.bookmakers).toEqual([expect.objectContaining({ bookmaker: "betway", lastEvents: 950, health: "ok" })]);
    expect((await request(raw).get("/api/admin/bookmakers")).status).toBe(401);
    expect((await request(withCookie(raw, cookieFor(member.id))).get("/api/admin/bookmakers")).status).toBe(403);
  });

  it("gives The Odds API's credits left from the worker's cache file, null without one", async () => {
    const { auth, odds, cookieFor, admin } = await setup();
    const dir = mkdtempSync(join(tmpdir(), "odds-api-"));
    const file = join(dir, "cache.json");
    const app = withCookie(createServer(odds, {}, { auth, oddsApiCacheFile: file }), cookieFor(admin.id));
    expect((await request(app).get("/api/admin/bookmakers")).body.oddsApiCredits).toBeNull();
    writeFileSync(file, JSON.stringify({ competitions: {}, creditsLeft: 494, creditsCheckedAt: "2026-11-01T04:08:00.000Z" }));
    expect((await request(app).get("/api/admin/bookmakers")).body.oddsApiCredits).toMatchObject({ creditsLeft: 494, checkedAt: "2026-11-01T04:08:00.000Z", floor: 20, refreshMinutes: null, readsLeft: null });
  });
});

describe("GET /api/admin/promo-readers", () => {
  it("gives the admins each promo reader's state, and nobody else", async () => {
    const { asAdmin, raw, member, cookieFor, odds, auth } = await setup();
    saveSitePromos(auth.db, "neobet", [{ sourceKey: "neobet:1", bookmaker: "neobet", title: "Quoten-Boost", details: "", url: null, endsAt: null }]);
    await runSitePromoAlerts(odds, [{ bookmaker: "twentybet", ok: false, error: "HTTP 404" }], {});
    const res = await request(asAdmin).get("/api/admin/promo-readers");
    expect(res.status).toBe(200);
    const byName = Object.fromEntries((res.body.readers as { bookmaker: string }[]).map((r) => [r.bookmaker, r]));
    expect(Object.keys(byName)).toEqual(["betathome", "neobet", "admiralbet", "twentybet", "merkurbets"]);
    expect(byName.neobet).toMatchObject({ count: 1, newestTitle: "Quoten-Boost" });
    expect(byName.neobet).not.toHaveProperty("failing");
    expect(byName.twentybet).toMatchObject({ count: 0, failing: { lastError: "HTTP 404" } });
    expect((await request(raw).get("/api/admin/promo-readers")).status).toBe(401);
    expect((await request(withCookie(raw, cookieFor(member.id))).get("/api/admin/promo-readers")).status).toBe(403);
  });
});

describe("GET /api/admin/usage", () => {
  it("gives the admins the bet tracker's counts, never a bet or an amount, and nobody else", async () => {
    const { asAdmin, raw, member, admin, cookieFor, auth } = await setup();
    const start = new Date(auth.now().getTime() + 90 * 60_000).toISOString();
    const db = auth.db;
    const now = auth.now().toISOString();
    db.prepare(
      "INSERT INTO user_taken_surebets (user_id, surebet_key, event_id, start_time, label, remind, created_at, stakes) VALUES (?, ?, 'e', ?, 'Secret label', 0, ?, ?)"
    ).run(member.id, "s1", start, now, "[50,52]");
    db.prepare("INSERT INTO user_taken_surebets (user_id, surebet_key, event_id, start_time, label, remind, created_at) VALUES (?, ?, 'e', ?, 'x', 0, ?)").run(
      admin.id,
      "s2",
      start,
      now
    );
    db.prepare(
      "INSERT INTO user_taken_value_bets (user_id, bet_key, event_id, start_time, label, market, selection, bookmaker, price, edge, created_at, stake) VALUES (?, 'v1', 'e', ?, 'x', '1X2', '1', 'twentybet', 2, 0.05, ?, 20)"
    ).run(member.id, start, now);
    db.prepare("INSERT INTO user_surebet_results (user_id, surebet_key, start_time, month, profit_cents) VALUES (?, 'old', ?, ?, 670)").run(
      member.id,
      now,
      "2026-10"
    );
    const res = await request(asAdmin).get("/api/admin/usage");
    expect(res.status).toBe(200);
    expect(res.body.usage).toEqual({
      month: "2026-10",
      activity: { seenDay: 1, seenWeek: 1, newWeek: 2, openFeedback: 0 },
      surebets: { accounts: 2, held: 2, withStakes: 1, monthResults: 1, monthAccounts: 1 },
      valueBets: { accounts: 1, held: 1, withStakes: 1, monthResults: 0, monthAccounts: 0 },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/Secret|670|ada@/);
    expect((await request(raw).get("/api/admin/usage")).status).toBe(401);
    expect((await request(withCookie(raw, cookieFor(member.id))).get("/api/admin/usage")).status).toBe(403);
  });
});

describe("GET /api/admin/usage, the testers' activity", () => {
  it("counts the accounts seen in a day and a week, the new ones, and the open feedback", async () => {
    const { asAdmin, member, auth } = await setup();
    const db = auth.db;
    const now = auth.now().getTime();
    const iso = (hoursAgo: number) => new Date(now - hoursAgo * 3600_000).toISOString();
    // The member last seen three days ago; an old account never seen.
    createSession(db, member.id, {}, new Date(now - 72 * 3600_000));
    db.prepare("INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES ('old', 'old@example.com', 'x', ?, ?)").run(iso(24 * 30), iso(24 * 30));
    db.prepare("INSERT INTO feedback (user_id, message, page, created_at) VALUES (?, 'a', '/', ?), (?, 'b', '/', ?)").run(member.id, iso(1), member.id, iso(2));
    db.prepare("UPDATE feedback SET done_at = ? WHERE message = 'b'").run(iso(0));
    const res = await request(asAdmin).get("/api/admin/usage");
    expect(res.body.usage.activity).toEqual({ seenDay: 1, seenWeek: 2, newWeek: 2, openFeedback: 1 });
  });
});

describe("GET /api/admin/alerts", () => {
  it("gives the admins the last 7 days' alerts, and nobody else", async () => {
    const { asAdmin, raw, member, cookieFor, odds, auth } = await setup();
    const { recordSentGems } = await import("../../src/db/alerts");
    const sentAt = new Date(auth.now().getTime() - 60 * 60_000).toISOString();
    recordSentGems(odds, [
      { eventId: "e", market: "1X2", selection: "1", bookmaker: "twentybet", basis: "fair", price: 2, fair: 1.9, edge: 0.05, label: "", marketLabel: "", matchLabel: "", startTime: sentAt, sentAt },
    ]);
    const res = await request(asAdmin).get("/api/admin/alerts");
    expect(res.status).toBe(200);
    expect(res.body.alerts).toMatchObject({ surebets: 0, gems: 1, bestGem: 0.05, byBookmaker: "By bookmaker: 20bet 1" });
    expect((await request(raw).get("/api/admin/alerts")).status).toBe(401);
    expect((await request(withCookie(raw, cookieFor(member.id))).get("/api/admin/alerts")).status).toBe(403);
  });
});
