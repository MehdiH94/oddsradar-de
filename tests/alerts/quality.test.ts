import { describe, it, expect, vi } from "vitest";
import { openDb } from "../../src/db/client";
import { upsertCanonicalEvents } from "../../src/db/repository";
import { getSuspectSurebets, getSurebets } from "../../src/db/surebets";
import { MAX_QUALITY_ALERTS, runQualityAlerts, suspectMessage } from "../../src/alerts/quality";
import { CanonicalEvent } from "../../src/types";

const WEBHOOK = "https://discord.com/api/webhooks/1/admin";
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600e3).toISOString();
const main = (market: string, prices: Record<string, number>) =>
  Object.entries(prices).map(([selection, price]) => ({ market, selection, price }));
const event = (id: string, participants: string[], byBookmaker: CanonicalEvent["byBookmaker"]): CanonicalEvent => ({
  id,
  sport: "football",
  competition: "Belgium. First Division. Women",
  startTime: hoursFromNow(5),
  participants,
  byBookmaker,
});
// Real case (20/10/2026): Betway's 9.47 on K Olsa Brakel (W), where 20bet paid 2.07.
const brugge = (id = "brugge-brakel") =>
  event(id, ["Club Brugge II (W)", "K Olsa Brakel (W)"], {
    twentybet: main("1X2", { "1": 2.63, X: 3.73, "2": 2.07 }),
    betway: main("1X2", { "1": 1.3, X: 6.16, "2": 9.47 }),
  });

function discord() {
  const sent: string[] = [];
  const send = vi.fn(async (_url: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body).content);
    return { ok: true, status: 204 };
  });
  return { sent, send };
}

describe("getSuspectSurebets", () => {
  it("gives the surebet the site leaves out, with the leg out of line and the others' price", () => {
    const db = openDb(":memory:");
    upsertCanonicalEvents(db, [brugge()]);
    expect(getSurebets(db)).toEqual([]);
    const [suspect] = getSuspectSurebets(db);
    expect(suspect).toMatchObject({ eventId: "brugge-brakel", market: "1X2", payoutRate: expect.closeTo(1 / (1 / 2.63 + 1 / 6.16 + 1 / 9.47), 10) });
    // Its first leg out of line: 20bet's 2.63 on Brugge, where Betway pays 1.30.
    // With two sources, either may be the wrong one: the admins look.
    expect(suspect.suspect).toMatchObject({ leg: { source: "twentybet", selection: "1", price: 2.63 }, others: 1.3 });
  });
});

describe("getSurebets withSuspects", () => {
  it("gives the suspects too, marked, after asking for them only", () => {
    const db = openDb(":memory:");
    upsertCanonicalEvents(db, [brugge()]);
    expect(getSurebets(db)).toEqual([]);
    const [shown] = getSurebets(db, { withSuspects: true });
    expect(shown).toMatchObject({ eventId: "brugge-brakel", suspect: { leg: { source: "twentybet" }, others: 1.3 } });
    expect(shown.marketCount).toBe(1);
  });
});

describe("suspectMessage", () => {
  it("gives every bet for 100 €, its stake and the profit, then the price out of line", () => {
    const db = openDb(":memory:");
    upsertCanonicalEvents(db, [brugge()]);
    const [suspect] = getSuspectSurebets(db);
    const text = suspectMessage(suspect, "https://odds-blitzer.de").content;
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/^🔎 \*\*Suspect surebet, \d+\.\d %\*\* \(\+\d+\.\d\d € on 100 €\): Club Brugge II \(W\) - K Olsa Brakel \(W\) \(Belgium\. First Division\. Women\), .*kick-off <t:\d+:f>/);
    expect(lines.slice(1, 4)).toEqual([
      expect.stringMatching(/^• back Club Brugge II \(W\) @ 20bet 2\.63: stake \d+\.\d\d €$/),
      expect.stringMatching(/^• back .* @ Betway 6\.16: stake \d+\.\d\d €$/),
      expect.stringMatching(/^• back K Olsa Brakel \(W\) @ Betway 9\.47: stake \d+\.\d\d €$/),
    ]);
    expect(lines[4]).toMatch(/^⚠️ 20bet pays 2\.63 on Club Brugge II \(W\), the other sources 1\.30: .*Check the price at the bookmaker before betting/);
    expect(lines[5]).toMatch(/^https:\/\/odds-blitzer\.de\/\?match=brugge-brakel&/);
  });

  it("keeps a race's many legs under Discord's 2000 characters", () => {
    const db = openDb(":memory:");
    upsertCanonicalEvents(db, [brugge()]);
    const [suspect] = getSuspectSurebets(db);
    const many = { ...suspect, legs: Array.from({ length: 80 }, (_, i) => ({ ...suspect.legs[0], label: `Runner number ${i}` })) };
    const text = suspectMessage(many).content;
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(text).toMatch(/\n• and \d+ more, on the site\n⚠️/);
  });
});

describe("runQualityAlerts", () => {
  it("tells the admins once about a suspect, with its prices and its match's link", async () => {
    const db = openDb(":memory:");
    upsertCanonicalEvents(db, [brugge()]);
    const { sent, send } = discord();

    await runQualityAlerts(db, { webhookUrl: WEBHOOK, publicUrl: "https://odds-blitzer.de", send });
    await runQualityAlerts(db, { webhookUrl: WEBHOOK, publicUrl: "https://odds-blitzer.de", send });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Club Brugge II (W) - K Olsa Brakel (W)");
    expect(sent[0]).toContain("20bet pays 2.63 on Club Brugge II (W)");
    expect(sent[0]).toContain("the other sources 1.30");
    expect(sent[0]).toContain("https://odds-blitzer.de/?match=brugge-brakel");
    expect(send.mock.calls.every(([url]) => url === WEBHOOK)).toBe(true);
  });

  it(`sends ${MAX_QUALITY_ALERTS} a cycle at most, the rest the next ones`, async () => {
    const db = openDb(":memory:");
    upsertCanonicalEvents(db, Array.from({ length: MAX_QUALITY_ALERTS + 2 }, (_, i) => brugge(`m${i}`)));
    const { sent, send } = discord();
    await runQualityAlerts(db, { webhookUrl: WEBHOOK, send });
    expect(sent).toHaveLength(MAX_QUALITY_ALERTS);
    await runQualityAlerts(db, { webhookUrl: WEBHOOK, send });
    expect(sent).toHaveLength(MAX_QUALITY_ALERTS + 2);
  });

  it("says nothing without a webhook, nor of a real surebet, and never throws", async () => {
    const db = openDb(":memory:");
    upsertCanonicalEvents(db, [
      brugge(),
      event("real", ["A", "B"], {
        twentybet: main("Vainqueur du match", { "1": 2.4, "2": 1.75 }),
        betway: main("Vainqueur du match", { "1": 2.0, "2": 2.15 }),
      }),
    ]);
    const { sent, send } = discord();
    await runQualityAlerts(db, { send });
    expect(sent).toEqual([]);

    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = vi.fn(async () => {
      throw new Error("Discord is down");
    });
    await expect(runQualityAlerts(db, { webhookUrl: WEBHOOK, send: failing, sleep: async () => {} })).resolves.toBeUndefined();
    // Not marked told: tried again next cycle.
    await runQualityAlerts(db, { webhookUrl: WEBHOOK, send });
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toContain("A - B");
  });
});
