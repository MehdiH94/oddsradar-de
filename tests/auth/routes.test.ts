import { describe, expect, it } from "vitest";
import request from "supertest";
import { openDb } from "../../src/db/client";
import { createServer } from "../../src/api/server";
import { addUser, linkIn, PASSWORD, SITE, testAuth } from "./helpers";

function setup() {
  const t = testAuth();
  const app = createServer(openDb(":memory:"), {}, { auth: t.auth });
  // JSON from this site, like the page's own fetch.
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    request(app).post(path).set({ Origin: SITE, ...headers }).send(body as object);
  return { ...t, app, post };
}

const tokenOf = (link: string) => new URL(link).searchParams.get("token")!;
const cookieOf = (res: request.Response) => (res.headers["set-cookie"] as unknown as string[])[0].split(";")[0];

describe("sign-up and email confirmation", () => {
  it("creates the account, mails a link, and logs in only once the link is used", async () => {
    const { post, sent, app } = setup();
    const created = await post("/api/auth/register", { email: " Ada@Example.com ", password: PASSWORD });
    expect(created.status).toBe(202);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("ada@example.com");

    const early = await post("/api/auth/login", { email: "ada@example.com", password: PASSWORD });
    expect(early.status).toBe(403);
    expect(early.body.error).toBe("email_not_verified");

    const link = linkIn(sent[0]);
    expect(link.startsWith(`${SITE}/verify-email?token=`)).toBe(true);
    expect((await post("/api/auth/verify-email", { token: tokenOf(link) })).status).toBe(200);
    expect((await post("/api/auth/verify-email", { token: tokenOf(link) })).status).toBe(400);

    const login = await post("/api/auth/login", { email: "ADA@example.com", password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.user).toMatchObject({ email: "ada@example.com", role: "user" });

    const cookie = login.headers["set-cookie"] as unknown as string[];
    expect(cookie[0]).toMatch(/^__Host-session=/);
    expect(cookie[0]).toMatch(/HttpOnly/);
    expect(cookie[0]).toMatch(/Secure/);
    expect(cookie[0]).toMatch(/SameSite=Lax/);

    const me = await request(app).get("/api/auth/me").set("Cookie", cookieOf(login));
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("ada@example.com");
    expect((await request(app).get("/api/auth/me")).body).toEqual({ user: null });
  });

  it("rejects a bad email or a weak password", async () => {
    const { post, sent } = setup();
    expect((await post("/api/auth/register", { email: "nope", password: PASSWORD })).body.error).toBe("invalid_email");
    expect((await post("/api/auth/register", { email: "a@b.fr", password: "short" })).body.error).toBe("weak_password");
    expect(sent).toHaveLength(0);
  });

  it("answers the same for an email that already has an account, and does not create a second one", async () => {
    const { post, sent, auth } = setup();
    await addUser(auth.db);
    const res = await post("/api/auth/register", { email: "ada@example.com", password: "another long secret" });
    const fresh = await post("/api/auth/register", { email: "new@example.com", password: "another long secret" });
    expect(res.status).toBe(fresh.status);
    expect(res.body).toEqual(fresh.body);
    expect(auth.db.prepare("SELECT COUNT(*) AS n FROM users").get()).toEqual({ n: 2 });
    // The owner gets a notice, not the stranger.
    expect(sent.map((m) => m.to)).toEqual(["ada@example.com", "new@example.com"]);
  });

  it("resends the link for an unconfirmed account, silently for the others", async () => {
    const { post, sent, auth } = setup();
    await addUser(auth.db, "late@example.com", { verified: false });
    const known = await post("/api/auth/resend-verification", { email: "late@example.com" });
    const unknown = await post("/api/auth/resend-verification", { email: "ghost@example.com" });
    expect(known.body).toEqual(unknown.body);
    expect(sent.map((m) => m.to)).toEqual(["late@example.com"]);
  });
});

describe("login", () => {
  it("gives the same answer for a wrong password and an unknown email", async () => {
    const { post, auth } = setup();
    await addUser(auth.db);
    const wrong = await post("/api/auth/login", { email: "ada@example.com", password: "not the password" });
    const unknown = await post("/api/auth/login", { email: "ghost@example.com", password: "not the password" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.headers["set-cookie"]).toBeUndefined();
  });

  it("slows down a guesser: 429 with Retry-After after 8 tries on one email", async () => {
    const { post, auth } = setup();
    await addUser(auth.db);
    for (let i = 0; i < 8; i++) expect((await post("/api/auth/login", { email: "ada@example.com", password: "wrong wrong wrong" })).status).toBe(401);
    const blocked = await post("/api/auth/login", { email: "ada@example.com", password: PASSWORD });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("refuses a disabled account", async () => {
    const { post, auth } = setup();
    const user = await addUser(auth.db);
    auth.db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(user.id);
    expect((await post("/api/auth/login", { email: "ada@example.com", password: PASSWORD })).body.error).toBe("account_disabled");
  });

  it("logs out for good: the old cookie no longer opens anything", async () => {
    const { post, app, auth } = setup();
    await addUser(auth.db);
    const login = await post("/api/auth/login", { email: "ada@example.com", password: PASSWORD });
    const cookie = cookieOf(login);
    expect((await post("/api/auth/logout", {}, { Cookie: cookie })).status).toBe(204);
    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).body).toEqual({ user: null });
    expect((await request(app).get("/api/sports").set("Cookie", cookie)).status).toBe(401);
  });

  it("answers no-store", async () => {
    const { post } = setup();
    expect((await post("/api/auth/login", { email: "a@b.fr", password: "x" })).headers["cache-control"]).toBe("no-store");
  });
});

describe("password reset", () => {
  it("mails a link, sets the new password, ends every session, and spends the link", async () => {
    const { post, sent, app, auth } = setup();
    await addUser(auth.db);
    const login = await post("/api/auth/login", { email: "ada@example.com", password: PASSWORD });
    const cookie = cookieOf(login);

    const asked = await post("/api/auth/forgot-password", { email: "ada@example.com" });
    const ghost = await post("/api/auth/forgot-password", { email: "ghost@example.com" });
    expect(asked.body).toEqual(ghost.body);
    expect(sent).toHaveLength(1);
    const token = tokenOf(linkIn(sent[0]));

    const weak = await post("/api/auth/reset-password", { token, password: "short" });
    expect(weak.body.error).toBe("weak_password");

    const reset = await post("/api/auth/reset-password", { token, password: "a brand new secret" });
    expect(reset.status).toBe(200);
    expect((await post("/api/auth/reset-password", { token, password: "yet another secret" })).status).toBe(400);

    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).body).toEqual({ user: null });
    expect((await post("/api/auth/login", { email: "ada@example.com", password: PASSWORD })).status).toBe(401);
    expect((await post("/api/auth/login", { email: "ada@example.com", password: "a brand new secret" })).status).toBe(200);
  });

  it("an unknown or expired link changes nothing", async () => {
    const { post, clock, sent, auth } = setup();
    await addUser(auth.db);
    expect((await post("/api/auth/reset-password", { token: "made-up", password: "a brand new secret" })).status).toBe(400);
    await post("/api/auth/forgot-password", { email: "ada@example.com" });
    clock.now = new Date(clock.now.getTime() + 61 * 60 * 1000);
    expect((await post("/api/auth/reset-password", { token: tokenOf(linkIn(sent[0])), password: "a brand new secret" })).status).toBe(400);
  });
});

describe("request origin", () => {
  it("refuses a change from another site or not sent as JSON", async () => {
    const { post, app } = setup();
    expect((await post("/api/auth/login", { email: "a@b.fr", password: "x" }, { Origin: "https://evil.example" })).status).toBe(403);
    const form = await request(app).post("/api/auth/login").set("Origin", SITE).type("form").send({ email: "a@b.fr", password: "x" });
    expect(form.status).toBe(403);
  });
});
