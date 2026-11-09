import { DatabaseSync } from "node:sqlite";
import { APP_NAME } from "../brand";
import { getAlertState, setAlertState } from "../db/alerts";
import { lugasMonth } from "../deposits/deposits";
import { DiscordMessage, post, Send } from "./gems";

// On the 1st of each month (Berlin, from 10:00), one message to the testers'
// Discord (DISCORD_WEBHOOK_URL) with what the alerts sent in the past month
// came to: how many surebets and 💎 value bets, the best edge of each and the
// busiest day. Counts and percentages only, never a bookmaker or a price (the
// owner's rule, 23/10/2026), like the Sunday summary (./weeklySummary.ts). The
// month sent for is kept in alert_state.

export const MONTHLY_SUMMARY_KEY = "monthly_summary_sent_for";
export const MONTHLY_SUMMARY_HOUR = 10;

const BERLIN = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
const BERLIN_DAY = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit" });
const MONTH_NAME = new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", month: "long" });
const percent = (edge: number) => `+${(edge * 100).toFixed(1).replace(".", ",")} %`;

// The month ("2026-10") a summary is due for at `now`: the one before, on the
// 1st (Berlin) from MONTHLY_SUMMARY_HOUR; null otherwise.
export function monthlySummaryMonth(now: Date): string | null {
  const p = Object.fromEntries(BERLIN.formatToParts(now).map((x) => [x.type, x.value]));
  if (p.day !== "01" || Number(p.hour) < MONTHLY_SUMMARY_HOUR) return null;
  const [y, m] = [Number(p.year), Number(p.month)];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export interface MonthCounts {
  month: string;
  surebets: number;
  gems: number;
  bestSurebet: number | null;
  bestGem: number | null;
  // The day most alerts were sent on ("17.10.") and how many, null with none.
  busiestDay: { day: string; count: number } | null;
}

// The alerts sent in `month` (Berlin), read from the 40 days before `now`.
export function monthCounts(db: DatabaseSync, month: string, now: Date): MonthCounts {
  const rows = (
    db
      .prepare("SELECT basis, edge, sent_at AS sentAt FROM gem_alerts WHERE sent_at >= ? AND sent_at <= ?")
      .all(new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString(), now.toISOString()) as { basis: string; edge: number; sentAt: string }[]
  ).filter((r) => lugasMonth(new Date(r.sentAt)) === month);
  const surebets = rows.filter((r) => r.basis.startsWith("surebet:"));
  const gems = rows.filter((r) => !r.basis.startsWith("surebet:"));
  const best = (list: typeof rows) => (list.length === 0 ? null : Math.max(...list.map((r) => r.edge)));
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const day = BERLIN_DAY.format(new Date(r.sentAt));
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  const busiest = [...byDay].sort((a, b) => b[1] - a[1])[0];
  return { month, surebets: surebets.length, gems: gems.length, bestSurebet: best(surebets), bestGem: best(gems), busiestDay: busiest ? { day: busiest[0], count: busiest[1] } : null };
}

export function monthlySummaryMessage(c: MonthCounts): DiscordMessage {
  const name = MONTH_NAME.format(new Date(`${c.month}-15T00:00:00Z`));
  const lines =
    c.surebets + c.gems === 0
      ? [`📅 **${name}**: keine Surebet und keine 💎 Value Bet gemeldet.`]
      : [
          `📅 **${name}**: ${c.surebets} Surebet${c.surebets === 1 ? "" : "s"} und ${c.gems} 💎 Value Bet${c.gems === 1 ? "" : "s"} gemeldet.`,
          ...(c.bestSurebet !== null ? [`Bester Surebet: ${percent(c.bestSurebet)}`] : []),
          ...(c.bestGem !== null ? [`Beste Value Bet: ${percent(c.bestGem)} Vorteil`] : []),
          ...(c.busiestDay ? [`Der stärkste Tag: ${c.busiestDay.day} (${c.busiestDay.count}).`] : []),
        ];
  return { username: APP_NAME, allowed_mentions: { parse: [] }, content: lines.join("\n") };
}

export interface MonthlySummaryOptions {
  webhookUrl?: string;
  now?: Date;
  send?: Send;
  sleep?: (ms: number) => Promise<void>;
}

// Never throws: a failure is logged, and it is tried again at the next check
// while it is still the 1st.
export async function runMonthlySummary(db: DatabaseSync, opts: MonthlySummaryOptions): Promise<boolean> {
  const url = opts.webhookUrl?.trim();
  if (!url) return false;
  const now = opts.now ?? new Date();
  const month = monthlySummaryMonth(now);
  if (!month || getAlertState(db, MONTHLY_SUMMARY_KEY) === month) return false;
  try {
    await post(opts.send ?? (fetch as unknown as Send), url, monthlySummaryMessage(monthCounts(db, month, now)), opts.sleep ?? ((t) => new Promise((r) => setTimeout(r, t))));
    setAlertState(db, MONTHLY_SUMMARY_KEY, month);
    return true;
  } catch (err) {
    console.error("[alerts:monthly] could not send the testers' monthly summary:", err);
    return false;
  }
}
