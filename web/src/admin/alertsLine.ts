import type { AdminAlerts } from "./adminApi";

// The last 7 days' alerts on the Usage tab, as the admins' weekly report says
// them (src/alerts/weekCounts.ts, formatWeekCounts and alertsByBookmaker):
// "Alerts sent in 7 days: 2 surebets (best +4.8 %), 1 value bet (best +23.1 %),
// most on Saturday. By bookmaker: 20bet 41, LeoVegas 12".
export function alertsLine(a: AdminAlerts): string {
  const pct = (edge: number | null) => (edge === null ? "" : ` (best +${(edge * 100).toFixed(1)} %)`);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const day = a.busiestDay ? `, most on ${a.busiestDay}` : "";
  const by = a.byBookmaker ? `. ${a.byBookmaker}` : "";
  return `Alerts sent in 7 days: ${plural(a.surebets, "surebet")}${pct(a.bestSurebet)}, ${plural(a.gems, "value bet")}${pct(a.bestGem)}${day}${by}`;
}
