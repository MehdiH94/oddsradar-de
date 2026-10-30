import { DatabaseSync } from "node:sqlite";
import { readState, ReaderState } from "../alerts/sitePromos";
import { getAlertState, setAlertState } from "../db/alerts";
import { SitePromoRead } from "./sitePromos";

// Each promo reader's state as production holds it, for `npm run promo-status`
// (vps-report promos): how many of its bookmaker's promotions auth.sqlite
// holds, the one found last, and its admin alert's state in the odds
// database (src/alerts/sitePromos.ts), so that a reader working in its tests
// but not from the server shows from outside it. With its last good read,
// kept in the same table after each hourly read (recordPromoReads): an OK
// reader whose newest promotion is days old still reads its page.

const LAST_READ_KEY = (bookmaker: string) => `site_promos_read:${bookmaker}`;

export interface PromoLastRead {
  at: string;
  found: number;
}

// After each hourly read (src/api/index.ts): each good read's time and count.
export function recordPromoReads(db: DatabaseSync, reads: readonly SitePromoRead[], now = new Date()): void {
  for (const read of reads) {
    if (read.ok) setAlertState(db, LAST_READ_KEY(read.bookmaker), JSON.stringify({ at: now.toISOString(), found: read.found ?? 0 }));
  }
}

function lastRead(db: DatabaseSync, bookmaker: string): PromoLastRead | null {
  try {
    const value = getAlertState(db, LAST_READ_KEY(bookmaker));
    return value ? (JSON.parse(value) as PromoLastRead) : null;
  } catch {
    return null;
  }
}

export interface PromoReaderStatus {
  bookmaker: string;
  count: number;
  newestTitle: string | null;
  newestFoundAt: string | null;
  // Set while its reads fail or find nothing; absent once it reads again.
  failing: ReaderState | undefined;
  // Its last good read, null before the first.
  lastRead: PromoLastRead | null;
}

export function listPromoReaderStatus(authDb: DatabaseSync, oddsDb: DatabaseSync, bookmakers: readonly string[]): PromoReaderStatus[] {
  const count = authDb.prepare("SELECT COUNT(*) AS n FROM promos WHERE source = 'site' AND bookmaker = ?");
  const newest = authDb.prepare(
    "SELECT title, found_at AS foundAt FROM promos WHERE source = 'site' AND bookmaker = ? ORDER BY found_at DESC, id DESC LIMIT 1"
  );
  return bookmakers.map((bookmaker) => {
    const row = newest.get(bookmaker) as { title: string; foundAt: string } | undefined;
    return {
      bookmaker,
      count: Number((count.get(bookmaker) as { n: number }).n),
      newestTitle: row?.title ?? null,
      newestFoundAt: row?.foundAt ?? null,
      failing: readState(oddsDb, bookmaker),
      lastRead: lastRead(oddsDb, bookmaker),
    };
  });
}

// One line each: OK, EMPTY (nothing held, not read yet), or FAILING (its
// reads fail or find nothing) with since when, whether the admins were told,
// and its last error; then its last good read.
export function formatPromoReaderStatus(statuses: readonly PromoReaderStatus[], now = Date.now()): string {
  const ago = (ms: number) => {
    const minutes = Math.round((now - ms) / 60_000);
    return minutes < 120 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
  };
  return statuses
    .map((s) => {
      const held =
        s.count === 0
          ? "no promotion held"
          : `${s.count} promotion${s.count === 1 ? "" : "s"}, newest "${s.newestTitle}" found ${ago(Date.parse(s.newestFoundAt!))}`;
      const read = s.lastRead ? `; last good read ${ago(Date.parse(s.lastRead.at))} (${s.lastRead.found} found)` : "; no good read recorded";
      if (!s.failing) return `${(s.count > 0 ? "OK" : "EMPTY").padEnd(7)} ${s.bookmaker.padEnd(12)} ${held}${read}`;
      const told = s.failing.alerted ? "admins told" : "admins not told yet";
      const error = (s.failing.lastError ?? "unknown").replace(/\s+/g, " ").slice(0, 300);
      return `FAILING ${s.bookmaker.padEnd(12)} ${held}; failing since ${ago(s.failing.failingSince)} (${told})${read}\n    error: ${error}`;
    })
    .join("\n");
}
