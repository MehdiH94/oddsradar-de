import { describe, expect, it, vi } from "vitest";
import { openDb } from "../../src/db/client";
import { openAuthDb } from "../../src/auth/db";
import { recordBookmakerRead } from "../../src/db/bookmakerStatus";
import { getAlertState } from "../../src/db/alerts";
import { formatSundayReports, runWeeklyReport, WEEKLY_REPORT_KEY, weeklyReportDay, weeklyReportMessage } from "../../src/alerts/weeklyReport";
import { setAlertState } from "../../src/db/alerts";

const WEBHOOK = "https://discord.com/api/webhooks/1/admin";

function discord() {
  const sent: { content: string; embeds: { title: string; description: string }[] }[] = [];
  const send = vi.fn(async (_url: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, status: 204 };
  });
  return { sent, send };
}

describe("weeklyReportDay", () => {
  it("is the Sunday from 18:00 Berlin time to its midnight", () => {
    // Sunday 08/11/2026: Berlin is UTC+1.
    expect(weeklyReportDay(new Date("2026-11-08T16:59:00Z"))).toBeNull();
    expect(weeklyReportDay(new Date("2026-11-08T17:00:00Z"))).toBe("2026-11-08");
    expect(weeklyReportDay(new Date("2026-11-08T22:59:00Z"))).toBe("2026-11-08");
    expect(weeklyReportDay(new Date("2026-11-08T23:00:00Z"))).toBeNull();
    expect(weeklyReportDay(new Date("2026-11-07T19:00:00Z"))).toBeNull();
  });
});

describe("runWeeklyReport", () => {
  it("sends the bookmakers' and promo readers' state once on Sunday evening", async () => {
    const odds = openDb(":memory:");
    const auth = openAuthDb(":memory:");
    const { sent, send } = discord();
    const now = new Date("2026-11-08T18:00:00Z");
    recordBookmakerRead(odds, "betway", { events: 1513 }, new Date(now.getTime() - 4 * 60_000).toISOString());
    const opts = { webhookUrl: WEBHOOK, send, promoReaders: ["neobet"], oddsApiCacheFile: "/nonexistent/cache.json" };

    expect(await runWeeklyReport(odds, auth, { ...opts, now })).toBe(true);
    expect(await runWeeklyReport(odds, auth, { ...opts, now: new Date("2026-11-08T21:00:00Z") })).toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0].content).toBe("📋 Weekly health report");
    expect(sent[0].embeds.map((e) => e.title)).toEqual(["Bookmakers", "Promo readers", "Usage"]);
    expect(sent[0].embeds[2].description).toContain("Activity: 0 seen in 24 h, 0 in 7 days, 0 new in 7 days, 0 feedback open");
    expect(sent[0].embeds[2].description).toContain("Alerts sent in 7 days: 0 surebets, 0 value bets");
    expect(sent[0].embeds[2].description).toContain("Surebets: 0 accounts, 0 held, 0 with stakes, 0 results kept in 2026-11");
    expect(sent[0].embeds[0].description).toContain("OK      betway       read 4 min ago: 1513 matches");
    expect(sent[0].embeds[0].description).toContain("The Odds API (tipico, winamaxde, Pinnacle): never read here");
    expect(sent[0].embeds[1].description).toContain("neobet");
    expect(getAlertState(odds, WEEKLY_REPORT_KEY)).toBe("2026-11-08");
    // The next Sunday, again.
    expect(await runWeeklyReport(odds, auth, { ...opts, now: new Date("2026-11-15T18:30:00Z") })).toBe(true);
  });

  it("sends nothing outside Sunday evening, nor without a webhook, and tries again when Discord fails", async () => {
    const odds = openDb(":memory:");
    const auth = openAuthDb(":memory:");
    const { sent, send } = discord();
    const opts = { send, promoReaders: [], oddsApiCacheFile: "/nonexistent/cache.json" };
    expect(await runWeeklyReport(odds, auth, { ...opts, webhookUrl: WEBHOOK, now: new Date("2026-11-08T10:00:00Z") })).toBe(false);
    expect(await runWeeklyReport(odds, auth, { ...opts, now: new Date("2026-11-08T18:00:00Z") })).toBe(false);
    expect(sent).toEqual([]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = vi.fn(async () => ({ ok: false, status: 500 }));
    expect(await runWeeklyReport(odds, auth, { ...opts, webhookUrl: WEBHOOK, send: failing, now: new Date("2026-11-08T18:00:00Z") })).toBe(false);
    expect(getAlertState(odds, WEEKLY_REPORT_KEY)).toBeUndefined();
    vi.restoreAllMocks();
  });

  it("keeps the message within Discord's limits whatever the lines", () => {
    const long = "x".repeat(9000);
    const message = weeklyReportMessage(long, "credits", long, long);
    const total = message.embeds!.reduce((sum, e) => sum + e.title.length + (e.description?.length ?? 0), 0);
    expect(total).toBeLessThanOrEqual(6000);
    expect(message.embeds![0].description!.length).toBeLessThanOrEqual(4096);
  });
});

describe("formatTrackerUsage", () => {
  it("puts the usage counts on three lines", async () => {
    const { formatTrackerUsage } = await import("../../src/auth/trackerUsage");
    const counts = { accounts: 1, held: 7, withStakes: 4, monthResults: 12, monthAccounts: 2 };
    expect(
      formatTrackerUsage({ month: "2026-11", activity: { seenDay: 4, seenWeek: 9, newWeek: 2, openFeedback: 3 }, surebets: counts, valueBets: { ...counts, monthResults: 0 } })
    ).toBe(
      [
        "Activity: 4 seen in 24 h, 9 in 7 days, 2 new in 7 days, 3 feedback open",
        "Surebets: 1 account, 7 held, 4 with stakes, 12 results kept in 2026-11 (2 accounts)",
        "Value bets: 1 account, 7 held, 4 with stakes, 0 results kept in 2026-11",
      ].join("\n")
    );
  });
});

describe("formatSundayReports", () => {
  it("says when each Sunday report was last sent", () => {
    const db = openDb(":memory:");
    expect(formatSundayReports(db)).toBe("Sunday reports: the admins' last sent for never, the testers' for never");
    setAlertState(db, WEEKLY_REPORT_KEY, "2026-11-08");
    setAlertState(db, "weekly_summary_sent_for", "2026-11-08");
    expect(formatSundayReports(db)).toBe("Sunday reports: the admins' last sent for 2026-11-08, the testers' for 2026-11-08");
  });
});

describe("formatWeekCounts", () => {
  it("says the week's alerts in English", async () => {
    const { formatWeekCounts } = await import("../../src/alerts/weekCounts");
    expect(formatWeekCounts({ surebets: 2, gems: 1, bestSurebet: 0.048, bestGem: 0.231, busiestDay: "Saturday" })).toBe(
      "Alerts sent in 7 days: 2 surebets (best +4.8 %), 1 value bet (best +23.1 %), most on Saturday"
    );
  });
});
