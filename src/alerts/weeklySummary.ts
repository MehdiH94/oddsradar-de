import { DatabaseSync } from "node:sqlite";
import { APP_NAME } from "../brand";
import { getAlertState, setAlertState } from "../db/alerts";
import { DiscordMessage, post, Send } from "./gems";
import { weekCounts, type WeekCounts } from "./weekCounts";
import { WEEKLY_SUMMARY_KEY_NAME, weeklyReportDay } from "./weeklyReport";

export { weekCounts, type WeekCounts };

// Once a week, on Sunday evening (Berlin, like the admins' report,
// ./weeklyReport.ts), one message to the testers' Discord (DISCORD_WEBHOOK_URL)
// with what the alerts found in the last 7 days: how many surebets and 💎
// value bets were sent, the best edge of each and the busiest day. Counts and
// percentages only: never a bookmaker or a price (the owner's rule,
// 23/10/2026). From the alerts sent (gem_alerts), the Sunday sent kept in
// alert_state.

export const WEEKLY_SUMMARY_KEY = WEEKLY_SUMMARY_KEY_NAME;
const percent = (edge: number) => `+${(edge * 100).toFixed(1).replace(".", ",")}\u202f%`;

export function weeklySummaryMessage(c: WeekCounts): DiscordMessage {
  const lines =
    c.surebets + c.gems === 0
      ? ["📊 **Diese Woche**: keine Surebet und keine 💎 Value Bet gemeldet."]
      : [
          `📊 **Diese Woche**: ${c.surebets} Surebet${c.surebets === 1 ? "" : "s"} und ${c.gems} 💎 Value Bet${c.gems === 1 ? "" : "s"} gemeldet.`,
          ...(c.bestSurebet !== null ? [`Bester Surebet: ${percent(c.bestSurebet)}`] : []),
          ...(c.bestGem !== null ? [`Beste Value Bet: ${percent(c.bestGem)} Vorteil`] : []),
          ...(c.busiestDay ? [`Die meisten am ${c.busiestDay}.`] : []),
        ];
  return { username: APP_NAME, allowed_mentions: { parse: [] }, content: lines.join("\n") };
}

export interface WeeklySummaryOptions {
  webhookUrl?: string;
  now?: Date;
  send?: Send;
  sleep?: (ms: number) => Promise<void>;
}

// Never throws: a failure is logged, and it is tried again at the next check
// while it is still that Sunday evening.
export async function runWeeklySummary(db: DatabaseSync, opts: WeeklySummaryOptions): Promise<boolean> {
  const url = opts.webhookUrl?.trim();
  if (!url) return false;
  const now = opts.now ?? new Date();
  const day = weeklyReportDay(now);
  if (!day || getAlertState(db, WEEKLY_SUMMARY_KEY) === day) return false;
  try {
    await post(opts.send ?? (fetch as unknown as Send), url, weeklySummaryMessage(weekCounts(db, now)), opts.sleep ?? ((t) => new Promise((r) => setTimeout(r, t))));
    setAlertState(db, WEEKLY_SUMMARY_KEY, day);
    return true;
  } catch (err) {
    console.error("[alerts:weekly] could not send the testers' weekly summary:", err);
    return false;
  }
}
