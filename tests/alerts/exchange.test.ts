import { describe, it, expect, vi } from "vitest";
import { openDb } from "../../src/db/client";
import { EXCHANGE_DOWN_AFTER_MS, runExchangeAlerts } from "../../src/alerts/exchange";
import { ExchangeReachability } from "../../src/reference/exchangeProxy";

const WEBHOOK = "https://discord.com/api/webhooks/1/admin";
const T0 = Date.parse("2026-10-25T17:00:00.000Z");
const minutes = (n: number) => T0 + n * 60_000;
const PROXY_DOWN = "Proxy response (500) !== 200 when HTTP Tunneling";

function discord() {
  const sent: string[] = [];
  const send = vi.fn(async (_url: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body).content);
    return { ok: true, status: 204 };
  });
  return { sent, send };
}

describe("runExchangeAlerts", () => {
  it("tells the admins once when the exchange has failed for 15 minutes, with the fix, and once when it answers again", async () => {
    const db = openDb(":memory:");
    const { sent, send } = discord();
    const failing: ExchangeReachability = { lastOkAt: minutes(-5), failingSince: T0, lastError: PROXY_DOWN };

    await runExchangeAlerts(db, { webhookUrl: WEBHOOK, now: minutes(14), reachability: failing, send });
    expect(sent).toEqual([]);
    await runExchangeAlerts(db, { webhookUrl: WEBHOOK, now: minutes(15), reachability: failing, send });
    await runExchangeAlerts(db, { webhookUrl: WEBHOOK, now: minutes(20), reachability: failing, send });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("**The exchange (Piwi) is unreachable** for 15 min");
    expect(sent[0]).toContain(`Last error: ${PROXY_DOWN}`);
    expect(sent[0]).toContain("sudo systemctl restart oddsradar-exchange-vpn oddsradar-exchange-proxy");
    expect(sent[0]).toContain("sudo /usr/local/sbin/oddsradar-exchange-vpn check");

    const back: ExchangeReachability = { lastOkAt: minutes(25) };
    await runExchangeAlerts(db, { webhookUrl: WEBHOOK, now: minutes(25), reachability: back, send });
    await runExchangeAlerts(db, { webhookUrl: WEBHOOK, now: minutes(30), reachability: back, send });
    expect(sent).toEqual([sent[0], "✅ **The exchange (Piwi)** answers again."]);
    expect(send.mock.calls.every(([url]) => url === WEBHOOK)).toBe(true);
  });

  it("says nothing while the exchange answers, nor without a webhook, and tries a failed send again", async () => {
    const db = openDb(":memory:");
    const { sent, send } = discord();
    await runExchangeAlerts(db, { webhookUrl: WEBHOOK, now: minutes(60), reachability: { lastOkAt: minutes(59) }, send });
    expect(sent).toEqual([]);

    const failing: ExchangeReachability = { failingSince: T0, lastError: PROXY_DOWN };
    await runExchangeAlerts(db, { webhookUrl: "", now: minutes(60), reachability: failing, send });
    expect(send).not.toHaveBeenCalled();

    vi.spyOn(console, "error").mockImplementation(() => {});
    const failingSend = vi.fn(async () => ({ ok: false, status: 500 }));
    await runExchangeAlerts(db, { webhookUrl: WEBHOOK, now: minutes(60), reachability: failing, send: failingSend });
    await runExchangeAlerts(db, { webhookUrl: WEBHOOK, now: minutes(65), reachability: failing, send });
    expect(sent).toHaveLength(1);
  });

  it("waits three cycles: one failed cycle is no outage", () => {
    expect(EXCHANGE_DOWN_AFTER_MS).toBe(15 * 60 * 1000);
  });
});
