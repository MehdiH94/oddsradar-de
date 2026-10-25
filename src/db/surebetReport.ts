import { DatabaseSync } from "node:sqlite";
import { getSurebets, legReadAt, Surebet } from "./surebets";
import { ListingOptions } from "./repository";

// Which sources the surebets come from, and how far apart their prices were
// read: the owner found that most surebets were 20bet's against the exchange
// (22/10/2026, docs/surebets-20bet.md). Read-only, run on the server
// (npm run surebet-report), its text pasted back to the backlog.

// A surebet's sources, as "20bet back + exchange lay": its legs' sources and
// sides, sorted, each once.
export function sourcePair(legs: readonly { source: string; side: string }[]): string {
  return [...new Set(legs.map((l) => `${l.source} ${l.side}`))].sort().join(" + ");
}

export interface PairCount {
  pair: string;
  count: number;
  // Their mean profit, 0.021 for +2.1%.
  meanEdge: number;
}

// The surebets sent to Discord since `since`, by sources: the alerts keep
// each one's combination of bets ("1@twentybet:back,1@exchange:lay").
export function sentSurebetsByPair(db: DatabaseSync, since: string): PairCount[] {
  const rows = db
    .prepare("SELECT bookmaker, edge FROM gem_alerts WHERE basis LIKE 'surebet:%' AND sent_at >= @since")
    .all({ since }) as { bookmaker: string; edge: number }[];
  return countByPair(
    rows.map((r) => ({
      pair: sourcePair(
        r.bookmaker.split(",").map((leg) => {
          const [, rest = ""] = leg.split("@");
          const [source, side = "back"] = rest.split(":");
          return { source, side };
        })
      ),
      edge: r.edge,
    }))
  );
}

// The profit from which a sent surebet is listed for checking.
export const HIGH_EDGE = 0.05;

export interface SentSurebet {
  matchLabel: string;
  marketLabel: string;
  // Its legs as the alert gave them: "Bayern München @ 20bet 2,30 / …".
  label: string;
  edge: number;
  startTime: string;
  sentAt: string;
}

// The surebets sent to Discord since `since` with a profit of at least
// `minEdge`, the highest first: so few pay that much that each is worth a
// look (a wrong match, a stale price), as the owner found Merkur Bets + 20bet
// at +15.5 % on average (24/10/2026).
export function sentSurebetsAbove(db: DatabaseSync, since: string, minEdge = HIGH_EDGE): SentSurebet[] {
  return db
    .prepare(
      `SELECT match_label AS matchLabel, market_label AS marketLabel, label, edge, start_time AS startTime, sent_at AS sentAt
       FROM gem_alerts WHERE basis LIKE 'surebet:%' AND sent_at >= @since AND edge >= @minEdge ORDER BY edge DESC, sent_at`
    )
    .all({ since, minEdge }) as unknown as SentSurebet[];
}

function countByPair(items: readonly { pair: string; edge: number }[]): PairCount[] {
  const byPair = new Map<string, { count: number; total: number }>();
  for (const { pair, edge } of items) {
    const entry = byPair.get(pair) ?? { count: 0, total: 0 };
    byPair.set(pair, { count: entry.count + 1, total: entry.total + edge });
  }
  return [...byPair]
    .map(([pair, { count, total }]) => ({ pair, count, meanEdge: total / count }))
    .sort((a, b) => b.count - a.count || a.pair.localeCompare(b.pair));
}

export interface SurebetReadGap {
  surebet: Surebet;
  pair: string;
  // Each leg's read time, in its order; null when it could not be found.
  readAt: (string | null)[];
  // Minutes between the first and the last read of its legs; null when one is
  // missing.
  gapMinutes: number | null;
}

// The surebets shown now, each with how far apart its legs were read.
export function currentSurebetReadGaps(db: DatabaseSync, opts: ListingOptions = {}): SurebetReadGap[] {
  return getSurebets(db, opts).map((surebet) => {
    const readAt = surebet.legs.map((leg) => legReadAt(db, surebet, leg));
    const times = readAt.map((at) => (at === null ? NaN : Date.parse(at)));
    const gapMinutes = times.some(Number.isNaN) ? null : (Math.max(...times) - Math.min(...times)) / 60_000;
    return { surebet, pair: sourcePair(surebet.legs), readAt, gapMinutes };
  });
}

const percent = (edge: number) => `${(edge * 100).toFixed(1)}%`;

// The report as text: the sent surebets by sources, those that paid the most,
// then the current ones by sources with their read gaps, then each current one.
export function formatSurebetReport(
  sent: readonly PairCount[],
  current: readonly SurebetReadGap[],
  since: string,
  high: readonly SentSurebet[] = []
): string {
  const lines = [`Surebets sent to Discord since ${since}, by sources:`];
  if (sent.length === 0) lines.push("  none");
  for (const p of sent) lines.push(`  ${p.count} × ${p.pair} (mean profit ${percent(p.meanEdge)})`);

  lines.push("", `Surebets sent at ${percent(HIGH_EDGE)} or more, to check (highest first):`);
  if (high.length === 0) lines.push("  none");
  for (const h of high) {
    lines.push(`  ${percent(h.edge)} ${h.matchLabel} · ${h.marketLabel} · kick-off ${h.startTime}, sent ${h.sentAt}`);
    lines.push(`    ${h.label}`);
  }

  lines.push("", "Surebets shown now, by sources:");
  const currentPairs = countByPair(current.map((c) => ({ pair: c.pair, edge: c.surebet.payoutRate - 1 })));
  if (currentPairs.length === 0) lines.push("  none");
  for (const p of currentPairs) {
    const gaps = current.filter((c) => c.pair === p.pair && c.gapMinutes !== null).map((c) => c.gapMinutes!);
    const gap = gaps.length > 0 ? `, read gap median ${median(gaps).toFixed(1)} min, max ${Math.max(...gaps).toFixed(1)} min` : "";
    lines.push(`  ${p.count} × ${p.pair} (mean profit ${percent(p.meanEdge)}${gap})`);
  }

  if (current.length > 0) lines.push("", "Each one:");
  for (const c of current) {
    const s = c.surebet;
    const legs = s.legs.map((l, i) => `${l.side} ${l.label} @ ${l.source} ${l.price}${l.size !== undefined ? ` (${l.size} € on it)` : ""}, read ${c.readAt[i] ?? "?"}`);
    const gap = c.gapMinutes === null ? "?" : `${c.gapMinutes.toFixed(1)} min`;
    lines.push(`  ${percent(s.payoutRate - 1)} ${s.participants.join(" - ")} · ${s.marketLabel} · read gap ${gap}`);
    for (const leg of legs) lines.push(`    ${leg}`);
  }
  return lines.join("\n");
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
