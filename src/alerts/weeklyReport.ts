import { DatabaseSync } from "node:sqlite";
import { APP_NAME } from "../brand";
import { getAlertState, setAlertState } from "../db/alerts";
import { BookmakerStatus, formatBookmakerStatus, listBookmakerStatus } from "../db/bookmakerStatus";
import { formatPromoReaderStatus, listPromoReaderStatus } from "../promos/status";
import { formatOddsApiCredits, oddsApiPace, readOddsApiCredits } from "../scraper/oddsApiCredits";
import { formatTrackerUsage, trackerUsage } from "../auth/trackerUsage";
import { formatWeekCounts, weekCounts } from "./weekCounts";
import { DiscordMessage, post, Send } from "./gems";

// Once a week, on Sunday evening (Berlin), one message to the administrators'
// Discord (DISCORD_ADMIN_WEBHOOK_URL) with what `vps-report bookmakers` and
// `vps-report promos` print: each bookmaker's health and matches, The Odds
// API's credits and pace, each promo reader's promotions and last good read,
// the week's alerts (./weekCounts.ts) and the admin Usage tab's counts (the
// testers' activity, the bet tracker),
// so that nobody has to run them to see the week end well. The Sunday it was
// sent for is kept in the odds database's alert_state, so that a restart does
// not send it twice.

export const WEEKLY_REPORT_KEY = "weekly_report_sent_for";
// Each bookmaker's matches at the last report (JSON), to flag a fall.
export const WEEKLY_MATCHES_KEY = "weekly_report_matches";
// The testers' summary's (./weeklySummary.ts), here so that both are read together.
export const WEEKLY_SUMMARY_KEY_NAME = "weekly_summary_sent_for";
// And the testers' monthly summary's (./monthlySummary.ts).
export const MONTHLY_SUMMARY_KEY_NAME = "monthly_summary_sent_for";
// From this hour on Sunday, Berlin time.
export const WEEKLY_REPORT_HOUR = 18;

const BERLIN = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  hourCycle: "h23",
});

// The Sunday (Berlin date, "2026-11-08") a report is due for at `now`: from
// WEEKLY_REPORT_HOUR on a Sunday to its midnight; null otherwise.
export function weeklyReportDay(now: Date): string | null {
  const parts = Object.fromEntries(BERLIN.formatToParts(now).map((p) => [p.type, p.value]));
  if (parts.weekday !== "Sun" || Number(parts.hour) < WEEKLY_REPORT_HOUR) return null;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const block = (title: string, text: string, max: number) => {
  const body = text.length > max ? `${text.slice(0, max - 1)}…` : text;
  return { title, color: 0x2563eb, description: "```\n" + body + "\n```", fields: [] };
};

export function weeklyReportMessage(bookmakers: string, credits: string, promos: string, usage?: string): DiscordMessage {
  return {
    username: APP_NAME,
    allowed_mentions: { parse: [] },
    content: "📋 Weekly health report",
    embeds: [
      block("Bookmakers", `${bookmakers}\n${credits}`, 3000),
      block("Promo readers", promos, 1800),
      ...(usage ? [block("Usage", usage, 900)] : []),
    ],
  };
}

export interface WeeklyReportOptions {
  webhookUrl?: string;
  now?: Date;
  oddsApiCacheFile?: string;
  promoReaders: readonly string[];
  send?: Send;
  sleep?: (ms: number) => Promise<void>;
}

// Never throws: a failure is logged, and the report is tried again at the
// next check while it is still that Sunday evening.
// The bookmakers whose matches (their last good read) fell by half or more
// since the last report, a scraper reading only part of a site being easy to
// miss otherwise: "betway 1513 → 600". The paced ones (The Odds API's) are
// left out, their counts following the credits; so are the small ones (under
// 50 matches before).
export function matchDrops(statuses: readonly BookmakerStatus[], before: Readonly<Record<string, number>>, paced: ReadonlySet<string>): string[] {
  return statuses.flatMap((s) => {
    const was = before[s.bookmaker];
    const now = s.lastGoodEvents ?? 0;
    if (paced.has(s.bookmaker) || typeof was !== "number" || was < 50 || now > was / 2) return [];
    return [`${s.bookmaker} ${was} → ${now}`];
  });
}

function readMatches(db: DatabaseSync): Record<string, number> {
  try {
    const parsed = JSON.parse(getAlertState(db, WEEKLY_MATCHES_KEY) ?? "{}") as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export async function runWeeklyReport(oddsDb: DatabaseSync, authDb: DatabaseSync, opts: WeeklyReportOptions): Promise<boolean> {
  const url = opts.webhookUrl?.trim();
  if (!url) return false;
  const now = opts.now ?? new Date();
  const day = weeklyReportDay(now);
  if (!day || getAlertState(oddsDb, WEEKLY_REPORT_KEY) === day) return false;
  try {
    const credits = readOddsApiCredits(opts.oddsApiCacheFile);
    const ms = now.getTime();
    const pace = oddsApiPace(credits);
    const statuses = listBookmakerStatus(oddsDb, ms, pace);
    const drops = matchDrops(statuses, readMatches(oddsDb), new Set(Object.keys(pace)));
    const dropLine = drops.length > 0 ? `⚠️ Matches fell by half or more since the last report: ${drops.join(", ")}\n` : "";
    const message = weeklyReportMessage(
      dropLine + formatBookmakerStatus(statuses, ms),
      formatOddsApiCredits(credits, ms),
      formatPromoReaderStatus(listPromoReaderStatus(authDb, oddsDb, opts.promoReaders), ms),
      `${formatWeekCounts(weekCounts(oddsDb, now, "en-GB"))}\n${formatTrackerUsage(trackerUsage(authDb, now))}`
    );
    await post(opts.send ?? (fetch as unknown as Send), url, message, opts.sleep ?? ((t) => new Promise((r) => setTimeout(r, t))));
    setAlertState(oddsDb, WEEKLY_REPORT_KEY, day);
    setAlertState(oddsDb, WEEKLY_MATCHES_KEY, JSON.stringify(Object.fromEntries(statuses.map((s) => [s.bookmaker, s.lastGoodEvents ?? 0]))));
    return true;
  } catch (err) {
    console.error("[alerts:weekly] could not send the weekly report:", err);
    return false;
  }
}

// When the Sunday reports were last sent, for `npm run bookmaker-status`
// (vps-report bookmakers): the admins' report and the testers' summary
// (./weeklySummary.ts), by the Sunday each was sent for, and the testers'
// monthly summary (./monthlySummary.ts), by its month.
export function formatSundayReports(db: DatabaseSync): string {
  const sent = (key: string) => getAlertState(db, key) ?? "never";
  return (
    `Sunday reports: the admins' last sent for ${sent(WEEKLY_REPORT_KEY)}, the testers' for ${sent(WEEKLY_SUMMARY_KEY_NAME)}; ` +
    `the testers' monthly summary last sent for ${sent(MONTHLY_SUMMARY_KEY_NAME)}`
  );
}
