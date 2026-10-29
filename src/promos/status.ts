import { DatabaseSync } from "node:sqlite";
import { readState, ReaderState } from "../alerts/sitePromos";

// Each promo reader's state as production holds it, for `npm run promo-status`
// (vps-report promos): how many of its bookmaker's promotions auth.sqlite
// holds, the one found last, and its admin alert's state in the odds
// database (src/alerts/sitePromos.ts), so that a reader working in its tests
// but not from the server shows from outside it.

export interface PromoReaderStatus {
  bookmaker: string;
  count: number;
  newestTitle: string | null;
  newestFoundAt: string | null;
  // Set while its reads fail or find nothing; absent once it reads again.
  failing: ReaderState | undefined;
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
    };
  });
}

// One line each: OK, EMPTY (nothing held, not read yet), or FAILING (its
// reads fail or find nothing) with since when, whether the admins were told,
// and its last error.
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
      if (!s.failing) return `${(s.count > 0 ? "OK" : "EMPTY").padEnd(7)} ${s.bookmaker.padEnd(12)} ${held}`;
      const told = s.failing.alerted ? "admins told" : "admins not told yet";
      const error = (s.failing.lastError ?? "unknown").replace(/\s+/g, " ").slice(0, 300);
      return `FAILING ${s.bookmaker.padEnd(12)} ${held}; failing since ${ago(s.failing.failingSince)} (${told})\n    error: ${error}`;
    })
    .join("\n");
}
