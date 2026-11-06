import { describe, expect, it, vi } from "vitest";
import { openDb } from "../../src/db/client";
import { getAlertState, recordSentGems, SentGem } from "../../src/db/alerts";
import { runWeeklySummary, WEEKLY_SUMMARY_KEY, weekCounts, weeklySummaryMessage } from "../../src/alerts/weeklySummary";

const WEBHOOK = "https://discord.com/api/webhooks/1/testers";
const NOW = new Date("2026-11-08T18:00:00Z");

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
  startTime: "2026-11-08T20:00:00Z",
  sentAt: "2026-11-07T12:00:00Z",
  ...over,
});

function seed() {
  const db = openDb(":memory:");
  recordSentGems(db, [
    // Saturday 07/11: a gem and two surebets.
    sent({ selection: "1", edge: 0.08 }),
    sent({ selection: "X", basis: "surebet:lay", edge: 0.031 }),
    sent({ selection: "2", basis: "surebet:bookmakers", edge: 0.048 }),
    // Friday 06/11: a gem.
    sent({ eventId: "f", edge: 0.231, sentAt: "2026-11-06T09:00:00Z" }),
    // Over a week ago: left out.
    sent({ eventId: "old", edge: 0.5, sentAt: "2026-10-31T09:00:00Z" }),
  ]);
  return db;
}

describe("the testers' weekly summary", () => {
  it("counts the week's surebets and gems, their best edge and the busiest day", () => {
    expect(weekCounts(seed(), NOW)).toEqual({ surebets: 2, gems: 2, bestSurebet: 0.048, bestGem: 0.231, busiestDay: "Samstag" });
  });

  it("says it in German, with no bookmaker and no price", () => {
    const message = weeklySummaryMessage(weekCounts(seed(), NOW));
    expect(message.content).toBe(
      "📊 **Diese Woche**: 2 Surebets und 2 💎 Value Bets gemeldet.\nBester Surebet: +4,8 %\nBeste Value Bet: +23,1 % Vorteil\nDie meisten am Samstag."
    );
    expect(message.content).not.toMatch(/20bet|twentybet|3,5|PSG/);
    expect(weeklySummaryMessage({ surebets: 0, gems: 0, bestSurebet: null, bestGem: null, busiestDay: null }).content).toBe(
      "📊 **Diese Woche**: keine Surebet und keine 💎 Value Bet gemeldet."
    );
  });

  it("sends it once on Sunday evening, and nothing without a webhook", async () => {
    const db = seed();
    const send = vi.fn(async () => ({ ok: true, status: 204 }));
    expect(await runWeeklySummary(db, { now: NOW, send })).toBe(false);
    expect(await runWeeklySummary(db, { webhookUrl: WEBHOOK, now: new Date("2026-11-08T10:00:00Z"), send })).toBe(false);
    expect(await runWeeklySummary(db, { webhookUrl: WEBHOOK, now: NOW, send })).toBe(true);
    expect(await runWeeklySummary(db, { webhookUrl: WEBHOOK, now: new Date("2026-11-08T20:00:00Z"), send })).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(getAlertState(db, WEEKLY_SUMMARY_KEY)).toBe("2026-11-08");
  });
});
