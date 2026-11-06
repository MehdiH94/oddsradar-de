import { describe, it, expect, vi } from "vitest";
import { openDb } from "../../src/db/client";
import { listBookmakerStatus, recordBookmakerRead } from "../../src/db/bookmakerStatus";
import { runHealthAlerts } from "../../src/alerts/health";

const WEBHOOK = "https://discord.com/api/webhooks/1/admin";
const T0 = Date.parse("2026-10-20T10:00:00.000Z");
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

function discord() {
  const sent: string[] = [];
  const send = vi.fn(async (_url: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body).content);
    return { ok: true, status: 204 };
  });
  return { sent, send };
}

describe("runHealthAlerts", () => {
  it("tells the admins once when a bookmaker goes down, once when it comes back", async () => {
    const db = openDb(":memory:");
    const { sent, send } = discord();
    recordBookmakerRead(db, "betway", { events: 950 }, at(0));
    recordBookmakerRead(db, "betway", { error: "betway GetCategoryDetails: HTTP 403" }, at(35));

    await runHealthAlerts(db, { webhookUrl: WEBHOOK, now: T0 + 35 * 60_000, send });
    await runHealthAlerts(db, { webhookUrl: WEBHOOK, now: T0 + 40 * 60_000, send });
    expect(sent).toEqual(["⚠️ **Betway** gives no odds for 35 min.\nLast error: betway GetCategoryDetails: HTTP 403"]);

    recordBookmakerRead(db, "betway", { events: 940 }, at(45));
    await runHealthAlerts(db, { webhookUrl: WEBHOOK, now: T0 + 45 * 60_000, send });
    await runHealthAlerts(db, { webhookUrl: WEBHOOK, now: T0 + 50 * 60_000, send });
    expect(sent).toHaveLength(2);
    expect(sent[1]).toBe("✅ **Betway** gives odds again (940 matches).");
    expect(send.mock.calls.every(([url]) => url === WEBHOOK)).toBe(true);
  });

  it("says nothing about a bookmaker failing for less than 30 minutes, nor without a webhook", async () => {
    const db = openDb(":memory:");
    const { sent, send } = discord();
    recordBookmakerRead(db, "oddset", { events: 800 }, at(0));
    recordBookmakerRead(db, "oddset", { events: 0 }, at(20));
    await runHealthAlerts(db, { webhookUrl: WEBHOOK, now: T0 + 20 * 60_000, send });
    recordBookmakerRead(db, "oddset", { events: 0 }, at(40));
    await runHealthAlerts(db, { now: T0 + 40 * 60_000, send });
    expect(sent).toEqual([]);
  });

  it("says nothing about a bookmaker paused between two paced reads", async () => {
    const db = openDb(":memory:");
    const { sent, send } = discord();
    recordBookmakerRead(db, "tipico", { events: 105 }, at(0));
    recordBookmakerRead(db, "tipico", { events: 0 }, at(180));
    await runHealthAlerts(db, { webhookUrl: WEBHOOK, now: T0 + 180 * 60_000, send, pace: { tipico: 800 * 60_000 } });
    expect(sent).toEqual([]);
  });

  it("tries again next cycle when Discord fails, without throwing", async () => {
    const db = openDb(":memory:");
    vi.spyOn(console, "error").mockImplementation(() => {});
    recordBookmakerRead(db, "admiralbet", { error: "socket closed" }, at(0));
    const failing = vi.fn(async () => ({ ok: false, status: 500 }));
    await expect(runHealthAlerts(db, { webhookUrl: WEBHOOK, now: T0, send: failing })).resolves.toBeUndefined();
    expect(listBookmakerStatus(db, T0)[0].downAlerted).toBe(false);
    vi.restoreAllMocks();
  });
});
