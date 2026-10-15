import { describe, expect, it } from "vitest";
import request from "supertest";
import { openDb } from "../../src/db/client";
import { createServer } from "../../src/api/server";
import { requireRole } from "../../src/auth/middleware";
import { addUser, sessionCookie, testAuth } from "../auth/helpers";
import { createSession } from "../../src/auth/store";

const DATA_ROUTES = [
  "/api/events",
  "/api/events/suggestions?q=psg",
  "/api/events/some-id",
  "/api/value-bets",
  "/api/stats/players",
  "/api/alerts",
  "/api/sports",
  "/api/preferences",
  "/api/freebets/wallet",
  "/api/freebets/conversions?mode=bookmakers",
  "/api/admin/users",
  // Not listed anywhere: a route added later under /api is protected too.
  "/api/something-new",
];

describe("the data routes need an account", () => {
  it.each(DATA_ROUTES)("%s answers 401 without a session", async (route) => {
    const app = createServer(openDb(":memory:"), {}, { auth: testAuth().auth });
    const res = await request(app).get(route);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthenticated");
  });

  it("opens them with a live session, and closes them again once it expires", async () => {
    const t = testAuth();
    const app = createServer(openDb(":memory:"), {}, { auth: t.auth });
    const cookie = await sessionCookie(t);
    expect((await request(app).get("/api/sports").set("Cookie", cookie)).status).toBe(200);
    t.clock.now = new Date(t.clock.now.getTime() + 8 * 24 * 60 * 60 * 1000);
    expect((await request(app).get("/api/sports").set("Cookie", cookie)).status).toBe(401);
  });

  it("ignores a forged or empty cookie", async () => {
    const app = createServer(openDb(":memory:"), {}, { auth: testAuth().auth });
    for (const cookie of ["__Host-session=forged", "__Host-session=", "session=anything", "%%%"]) {
      expect((await request(app).get("/api/events").set("Cookie", cookie)).status).toBe(401);
    }
  });

  it("leaves the home's totals public, without any price or match", async () => {
    const app = createServer(openDb(":memory:"), {}, { auth: testAuth().auth });
    const res = await request(app).get("/api/public/home");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["matches", "sports"]);
  });

  it("leaves the pages' shell public (no data in it)", async () => {
    const app = createServer(openDb(":memory:"), {}, { auth: testAuth().auth, webDist: "/nonexistent" });
    // No build here: a 404, not a 401 -- the guard is on /api.
    expect((await request(app).get("/cotes")).status).toBe(404);
  });

  it("answers the deploy's health check without an account", async () => {
    const res = await request(createServer(openDb(":memory:"), {}, { auth: testAuth().auth })).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("sends security headers", async () => {
    const res = await request(createServer(openDb(":memory:"), {}, { auth: testAuth().auth })).get("/api/sports");
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("requireRole", () => {
  it("lets a role through and answers 403 to the others, 401 to nobody", async () => {
    const t = testAuth();
    const express = (await import("express")).default;
    const { loadSession } = await import("../../src/auth/middleware");
    const app = express();
    app.use(loadSession(t.auth));
    app.get("/admin", requireRole("admin"), (_req, res) => void res.json({ ok: true }));
    const user = await addUser(t.auth.db, "user@example.com");
    const admin = await addUser(t.auth.db, "admin@example.com", { role: "admin" });
    const cookieFor = (id: string) => `__Host-session=${createSession(t.auth.db, id, {}, t.auth.now())}`;
    expect((await request(app).get("/admin")).status).toBe(401);
    expect((await request(app).get("/admin").set("Cookie", cookieFor(user.id))).status).toBe(403);
    expect((await request(app).get("/admin").set("Cookie", cookieFor(admin.id))).status).toBe(200);
  });
});
