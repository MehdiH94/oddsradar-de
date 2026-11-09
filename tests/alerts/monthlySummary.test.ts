import { describe, expect, it, vi } from "vitest";
import { openDb } from "../../src/db/client";
import { getAlertState, recordSentGems, SentGem } from "../../src/db/alerts";
import { MONTHLY_SUMMARY_KEY, monthCounts, monthlySummaryMessage, monthlySummaryMonth, runMonthlySummary } from "../../src/alerts/monthlySummary";

const WEBHOOK = "https://discord.com/api/webhooks/1/testers";
// 01/12/2026 10:00 in Berlin (UTC+1).
const NOW = new Date("2026-12-01T09:00:00Z");

const sent = (over: Partial<SentGem>): SentGem => ({
  eventId: "e",
  market: "1X2",
  selection: "1",
  bookmaker: "twentybet",
  basis: "fair",
  price: 3.5,
  fair: 3,
  edge: 0.1,
  label: "PSG",
  marketLabel: "1X2",
  matchLabel: "PSG - OM",
  startTime: "2026-11-20T20:00:00Z",
  sentAt: "2026-11-17T12:00:00Z",
  ...over,
});

function seed() {
  const db = openDb(":memory:");
  recordSentGems(db, [
    sent({ selection: "1", edge: 0.08 }),
    sent({ selection: "X", basis: "surebet:lay", edge: 0.031 }),
    sent({ eventId: "f", edge: 0.231, sentAt: "2026-11-03T09:00:00Z" }),
    // 30/11 at 23:30 UTC is 1 December in Berlin: next month's.
    sent({ eventId: "dec", edge: 0.5, sentAt: "2026-11-30T23:30:00Z" }),
    sent({ eventId: "oct", edge: 0.4, sentAt: "2026-10-31T12:00:00Z" }),
  ]);
  return db;
}

describe("the testers' monthly summary", () => {
  it("is due on the 1st from 10:00 Berlin, for the month before", () => {
    expect(monthlySummaryMonth(new Date("2026-12-01T08:59:00Z"))).toBeNull();
    expect(monthlySummaryMonth(NOW)).toBe("2026-11");
    expect(monthlySummaryMonth(new Date("2027-01-01T09:00:00Z"))).toBe("2026-12");
    expect(monthlySummaryMonth(new Date("2026-12-02T09:00:00Z"))).toBeNull();
  });

  it("counts the month's surebets and gems, their best edge and the busiest day", () => {
    expect(monthCounts(seed(), "2026-11", NOW)).toEqual({
      month: "2026-11",
      surebets: 1,
      gems: 2,
      bestSurebet: 0.031,
      bestGem: 0.231,
      busiestDay: { day: "17.11.", count: 2 },
    });
  });

  it("says it in German, with no bookmaker and no price", () => {
    const content = monthlySummaryMessage(monthCounts(seed(), "2026-11", NOW)).content;
    expect(content).toBe("📅 **November**: 1 Surebet und 2 💎 Value Bets gemeldet.\nBester Surebet: +3,1 %\nBeste Value Bet: +23,1 % Vorteil\nDer stärkste Tag: 17.11. (2).");
    expect(content).not.toMatch(/20bet|twentybet|3,5|PSG/);
  });

  it("sends it once on the 1st, and nothing without a webhook", async () => {
    const db = seed();
    const send = vi.fn(async () => ({ ok: true, status: 204 }));
    expect(await runMonthlySummary(db, { now: NOW, send })).toBe(false);
    expect(await runMonthlySummary(db, { webhookUrl: WEBHOOK, now: NOW, send })).toBe(true);
    expect(await runMonthlySummary(db, { webhookUrl: WEBHOOK, now: new Date("2026-12-01T15:00:00Z"), send })).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(getAlertState(db, MONTHLY_SUMMARY_KEY)).toBe("2026-11");
  });
});
