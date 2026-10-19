import { describe, expect, it } from "vitest";
import request from "supertest";
import { openDb } from "../../src/db/client";
import { openAuthDb } from "../../src/auth/db";
import { createServer } from "../../src/api/server";
import { listFeedback, MAX_FEEDBACK_LENGTH, parseFeedback, saveFeedback, setFeedbackDone } from "../../src/auth/feedback";
import { createSession, createUser } from "../../src/auth/store";
import { addUser, SITE, testAuth, withCookie } from "./helpers";

describe("parseFeedback", () => {
  it("keeps the message, trimmed, and the page it was sent from", () => {
    expect(parseFeedback({ message: "  Betway is missing tonight's NBA  ", page: "/odds?sport=basketball" })).toEqual({
      message: "Betway is missing tonight's NBA",
      page: "/odds?sport=basketball",
    });
  });

  it("drops a page that is not a path of the site", () => {
    expect(parseFeedback({ message: "Hi", page: "https://evil.example" })?.page).toBeNull();
    expect(parseFeedback({ message: "Hi", page: 3 })?.page).toBeNull();
    expect(parseFeedback({ message: "Hi" })?.page).toBeNull();
  });

  it.each([
    ["not an object", "hello"],
    ["null", null],
    ["no message", { page: "/odds" }],
    ["a message that is not text", { message: 12 }],
    ["an empty message", { message: "   " }],
    ["a message too long", { message: "x".repeat(MAX_FEEDBACK_LENGTH + 1) }],
  ])("refuses %s", (_label, body) => {
    expect(parseFeedback(body)).toBeNull();
  });
});

describe("the stored feedback", () => {
  it("lists the newest first with its author's email, is marked done and back, and goes with the account", () => {
    const db = openAuthDb(":memory:");
    const now = new Date("2026-10-19T10:00:00Z");
    const ada = createUser(db, { email: "ada@example.com", passwordHash: "x", verified: true }, now);
    saveFeedback(db, ada.id, { message: "First", page: null }, now);
    saveFeedback(db, ada.id, { message: "Second", page: "/odds" }, new Date("2026-10-19T11:00:00Z"));

    const [second, first] = listFeedback(db);
    expect(second).toMatchObject({ email: "ada@example.com", message: "Second", page: "/odds", createdAt: "2026-10-19T11:00:00.000Z", doneAt: null });
    expect(first.message).toBe("First");

    expect(setFeedbackDone(db, first.id, true, now)).toBe(true);
    expect(listFeedback(db)[1].doneAt).toBe("2026-10-19T10:00:00.000Z");
    setFeedbackDone(db, first.id, false, now);
    expect(listFeedback(db)[1].doneAt).toBeNull();
    expect(setFeedbackDone(db, 999, true, now)).toBe(false);

    db.prepare("DELETE FROM users WHERE id = ?").run(ada.id);
    expect(listFeedback(db)).toEqual([]);
  });
});

async function setup() {
  const t = testAuth();
  const raw = createServer(openDb(":memory:"), {}, { auth: t.auth });
  const admin = await addUser(t.auth.db, "root@example.com", { role: "admin" });
  const member = await addUser(t.auth.db, "ada@example.com");
  const cookieFor = (id: string) => `__Host-session=${createSession(t.auth.db, id, {}, t.auth.now())}`;
  const asAdmin = withCookie(raw, cookieFor(admin.id));
  const asMember = withCookie(raw, cookieFor(member.id));
  const send = (body: unknown, app = asMember, headers: Record<string, string> = { Origin: SITE }) =>
    request(app).post("/api/feedback").set(headers).send(body as object);
  return { ...t, raw, admin, member, asAdmin, asMember, send };
}

describe("POST /api/feedback", () => {
  it("stores a signed-in account's message, which the administration then lists", async () => {
    const { send, asAdmin } = await setup();
    expect((await send({ message: "Love it", page: "/odds" })).status).toBe(201);
    const res = await request(asAdmin).get("/api/admin/feedback");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.feedback).toEqual([
      expect.objectContaining({ email: "ada@example.com", message: "Love it", page: "/odds", doneAt: null }),
    ]);
  });

  it("needs an account, a message, and this site", async () => {
    const { raw, send, auth } = await setup();
    expect((await send({ message: "Hi" }, raw)).status).toBe(401);
    expect((await send({ message: "" })).status).toBe(400);
    expect((await send({ message: "x".repeat(9000) })).status).toBe(413);
    expect((await send({ message: "Hi" }, undefined, { Origin: "https://evil.example" })).status).toBe(403);
    expect(listFeedback(auth.db)).toEqual([]);
  });

  it("takes ten messages an hour from an account, no more", async () => {
    const { send, auth } = await setup();
    for (let i = 0; i < 10; i++) expect((await send({ message: `Message ${i}` })).status).toBe(201);
    const res = await send({ message: "One more" });
    expect(res.status).toBe(429);
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    expect(listFeedback(auth.db)).toHaveLength(10);
  });
});

describe("the administration's feedback", () => {
  it("is for admins alone", async () => {
    const { raw, asMember, send } = await setup();
    await send({ message: "Private" });
    expect((await request(raw).get("/api/admin/feedback")).status).toBe(401);
    expect((await request(asMember).get("/api/admin/feedback")).status).toBe(403);
    expect((await request(asMember).patch("/api/admin/feedback/1").set({ Origin: SITE }).send({ done: true })).status).toBe(403);
  });

  it("marks a message handled, then not", async () => {
    const { asAdmin, send } = await setup();
    await send({ message: "Bug on the match page" });
    const [{ id }] = (await request(asAdmin).get("/api/admin/feedback")).body.feedback;
    const done = await request(asAdmin).patch(`/api/admin/feedback/${id}`).set({ Origin: SITE }).send({ done: true });
    expect(done.status).toBe(200);
    expect(done.body.feedback.doneAt).toBe("2026-10-10T10:00:00.000Z");
    const undone = await request(asAdmin).patch(`/api/admin/feedback/${id}`).set({ Origin: SITE }).send({ done: false });
    expect(undone.body.feedback.doneAt).toBeNull();
  });

  it("refuses an invalid change, and a message that does not exist", async () => {
    const { asAdmin } = await setup();
    expect((await request(asAdmin).patch("/api/admin/feedback/1").set({ Origin: SITE }).send({ done: "yes" })).status).toBe(400);
    expect((await request(asAdmin).patch("/api/admin/feedback/abc").set({ Origin: SITE }).send({ done: true })).status).toBe(400);
    expect((await request(asAdmin).patch("/api/admin/feedback/42").set({ Origin: SITE }).send({ done: true })).status).toBe(404);
  });
});
