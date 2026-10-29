import { describe, it, expect, vi } from "vitest";
import { openDb } from "../../src/db/client";
import { runSitePromoAlerts, SITE_PROMOS_DOWN_AFTER_MS } from "../../src/alerts/sitePromos";

const WEBHOOK = "https://discord.com/api/webhooks/1/admin";
const T0 = Date.parse("2026-10-29T07:00:00.000Z");
const hours = (n: number) => T0 + n * 3_600_000;

function discord() {
  const sent: string[] = [];
  const send = vi.fn(async (_url: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body).content);
    return { ok: true, status: 204 };
  });
  return { sent, send };
}

const failed = { bookmaker: "twentybet", ok: false, error: "20bet promotions: HTTP 404" };
const read = { bookmaker: "twentybet", ok: true };

describe("runSitePromoAlerts", () => {
  it("tells the admins once when a bookmaker's promotions have failed for a day, and once when they are read again", async () => {
    const db = openDb(":memory:");
    const { sent, send } = discord();
    for (const at of [0, 1, 23]) await runSitePromoAlerts(db, [failed], { webhookUrl: WEBHOOK, now: hours(at), send });
    expect(sent).toEqual([]);
    await runSitePromoAlerts(db, [failed], { webhookUrl: WEBHOOK, now: hours(24), send });
    await runSitePromoAlerts(db, [failed], { webhookUrl: WEBHOOK, now: hours(25), send });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("**twentybet's promotions** have not been read for 24 h");
    expect(sent[0]).toContain("Last error: 20bet promotions: HTTP 404");
    expect(sent[0]).toContain("src/promos/twentybet.ts");

    await runSitePromoAlerts(db, [read], { webhookUrl: WEBHOOK, now: hours(26), send });
    await runSitePromoAlerts(db, [read], { webhookUrl: WEBHOOK, now: hours(27), send });
    expect(sent).toEqual([sent[0], "✅ **twentybet's promotions** are read again."]);
    expect(send.mock.calls.every(([url]) => url === WEBHOOK)).toBe(true);
    expect(SITE_PROMOS_DOWN_AFTER_MS).toBe(24 * 3_600_000);
  });

  it("counts a day from the first failure across restarts, says nothing of a short failure, and keeps each bookmaker apart", async () => {
    const db = openDb(":memory:");
    const { sent, send } = discord();
    await runSitePromoAlerts(db, [failed, { bookmaker: "neobet", ok: false, error: "x" }], { webhookUrl: WEBHOOK, now: hours(0), send });
    // neobet reads again after an hour: forgotten, no message.
    await runSitePromoAlerts(db, [{ bookmaker: "neobet", ok: true }], { webhookUrl: WEBHOOK, now: hours(1), send });
    // The state is in the database, as after a restart: 20bet's day still counts from hour 0.
    await runSitePromoAlerts(db, [failed, { bookmaker: "neobet", ok: false, error: "x" }], { webhookUrl: WEBHOOK, now: hours(24), send });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("twentybet");
  });

  it("keeps counting without a webhook, sends nothing, and never throws", async () => {
    const db = openDb(":memory:");
    const { sent, send } = discord();
    await runSitePromoAlerts(db, [failed], { now: hours(0), send });
    await runSitePromoAlerts(db, [failed], { now: hours(30), send });
    expect(sent).toEqual([]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = vi.fn(async () => {
      throw new Error("discord down");
    });
    await expect(runSitePromoAlerts(db, [failed], { webhookUrl: WEBHOOK, now: hours(31), send: failing })).resolves.toBeUndefined();
    vi.restoreAllMocks();
  });
});
