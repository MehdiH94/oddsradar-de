import { DatabaseSync } from "node:sqlite";
import { APP_NAME } from "../brand";
import { getAlertState, setAlertState } from "../db/alerts";
import { formatBookmakerStatus, listBookmakerStatus } from "../db/bookmakerStatus";
import { formatPromoReaderStatus, listPromoReaderStatus } from "../promos/status";
import { formatOddsApiCredits, oddsApiPace, readOddsApiCredits } from "../scraper/oddsApiCredits";
import { formatTrackerUsage, trackerUsage } from "../auth/trackerUsage";
import { DiscordMessage, post, Send } from "./gems";

// Once a week, on Sunday evening (Berlin), one message to the administrators'
// Discord (DISCORD_ADMIN_WEBHOOK_URL) with what `vps-report bookmakers` and
// `vps-report promos` print: each bookmaker's health and matches, The Odds
// API's credits and pace, each promo reader's promotions and last good read,
// and the admin Usage tab's counts (the testers' activity, the bet tracker),
// so that nobody has to run them to see the week end well. The Sunday it was
// sent for is kept in the odds database's alert_state, so that a restart does
// not send it twice.

export const WEEKLY_REPORT_KEY = "weekly_report_sent_for";
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
      block("Bookmakers", `${bookmakers}\n${credits}`, 3200),
      block("Promo readers", promos, 1800),
      ...(usage ? [block("Usage", usage, 700)] : []),
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
export async function runWeeklyReport(oddsDb: DatabaseSync, authDb: DatabaseSync, opts: WeeklyReportOptions): Promise<boolean> {
  const url = opts.webhookUrl?.trim();
  if (!url) return false;
  const now = opts.now ?? new Date();
  const day = weeklyReportDay(now);
  if (!day || getAlertState(oddsDb, WEEKLY_REPORT_KEY) === day) return false;
  try {
    const credits = readOddsApiCredits(opts.oddsApiCacheFile);
    const ms = now.getTime();
    const message = weeklyReportMessage(
      formatBookmakerStatus(listBookmakerStatus(oddsDb, ms, oddsApiPace(credits)), ms),
      formatOddsApiCredits(credits, ms),
      formatPromoReaderStatus(listPromoReaderStatus(authDb, oddsDb, opts.promoReaders), ms),
      formatTrackerUsage(trackerUsage(authDb, now))
    );
    await post(opts.send ?? (fetch as unknown as Send), url, message, opts.sleep ?? ((t) => new Promise((r) => setTimeout(r, t))));
    setAlertState(oddsDb, WEEKLY_REPORT_KEY, day);
    return true;
  } catch (err) {
    console.error("[alerts:weekly] could not send the weekly report:", err);
    return false;
  }
}
