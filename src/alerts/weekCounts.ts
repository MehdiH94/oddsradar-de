import { DatabaseSync } from "node:sqlite";
import { bookmakerName } from "./gems";

// What the alerts sent in the 7 days before `now` came to (gem_alerts): how
// many surebets and value bets, the best edge of each and the busiest day
// (Berlin). The testers' Sunday summary (./weeklySummary.ts) and the admins'
// report (./weeklyReport.ts) both show it.

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface WeekCounts {
  surebets: number;
  gems: number;
  bestSurebet: number | null;
  bestGem: number | null;
  // The weekday most alerts were sent on, in `locale` ("Samstag"), null with none.
  busiestDay: string | null;
}

export function weekCounts(db: DatabaseSync, now: Date, locale = "de-DE"): WeekCounts {
  const WEEKDAY = new Intl.DateTimeFormat(locale, { timeZone: "Europe/Berlin", weekday: "long" });
  const rows = db
    .prepare("SELECT basis, edge, sent_at AS sentAt FROM gem_alerts WHERE sent_at >= ? AND sent_at <= ?")
    .all(new Date(now.getTime() - WEEK_MS).toISOString(), now.toISOString()) as { basis: string; edge: number; sentAt: string }[];
  const surebets = rows.filter((r) => r.basis.startsWith("surebet:"));
  const gems = rows.filter((r) => !r.basis.startsWith("surebet:"));
  const best = (list: typeof rows) => (list.length === 0 ? null : Math.max(...list.map((r) => r.edge)));
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const day = WEEKDAY.format(new Date(r.sentAt));
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  const busiest = [...byDay].sort((a, b) => b[1] - a[1])[0];
  return { surebets: surebets.length, gems: gems.length, bestSurebet: best(surebets), bestGem: best(gems), busiestDay: busiest?.[0] ?? null };
}


// For the admins' report, in English: "Alerts sent in 7 days: 2 surebets
// (best +4.8 %), 2 value bets (best +23.1 %), most on Saturday".
export function formatWeekCounts(c: WeekCounts): string {
  const pct = (edge: number | null) => (edge === null ? "" : ` (best +${(edge * 100).toFixed(1)} %)`);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const day = c.busiestDay ? `, most on ${c.busiestDay}` : "";
  return `Alerts sent in 7 days: ${plural(c.surebets, "surebet")}${pct(c.bestSurebet)}, ${plural(c.gems, "value bet")}${pct(c.bestGem)}${day}`;
}

// Which bookmakers the alerts of the 7 days before `now` came from (the one
// each alert names; a surebet's, its first leg's), most first, for the admins'
// report only: "By bookmaker: 20bet 41, LeoVegas 12, Merkur Bets 9". The
// testers' messages never name one (the owner's rule, 23/10/2026).
export function alertsByBookmaker(db: DatabaseSync, now: Date, max = 8): string | null {
  const rows = db
    .prepare(
      "SELECT bookmaker, COUNT(*) AS n FROM gem_alerts WHERE sent_at >= ? AND sent_at <= ? GROUP BY bookmaker ORDER BY n DESC, bookmaker"
    )
    .all(new Date(now.getTime() - WEEK_MS).toISOString(), now.toISOString()) as { bookmaker: string; n: number }[];
  if (rows.length === 0) return null;
  const shown = rows.slice(0, max).map((r) => `${bookmakerName(r.bookmaker)} ${r.n}`);
  const rest = rows.length > max ? `, ${rows.length - max} more` : "";
  return `By bookmaker: ${shown.join(", ")}${rest}`;
}
