import { DatabaseSync } from "node:sqlite";

// A promotion the site read itself on a bookmaker's page (./betathome.ts…):
// everyone's, kept in auth.sqlite's `promos` with `source` "site", one row
// per `sourceKey` ("betathome:28774"), updated in place at each read so that
// the accounts' "taken" marks and reminders stay on it.
export interface SitePromo {
  sourceKey: string;
  bookmaker: string;
  title: string;
  details: string;
  url: string | null;
  endsAt: string | null;
}

// Saves one bookmaker's promotions as just read: new ones added, the others
// updated, and those no longer on its page (ended or withdrawn) removed,
// with their marks. An empty read removes nothing: a page that came back
// without its list is more likely broken than empty.
export function saveSitePromos(db: DatabaseSync, bookmaker: string, promos: readonly SitePromo[], now = new Date()): { added: number; removed: number } {
  if (promos.length === 0) return { added: 0, removed: 0 };
  let added = 0;
  db.exec("BEGIN");
  try {
    const exists = db.prepare("SELECT 1 FROM promos WHERE source = 'site' AND source_key = ?");
    const upsert = db.prepare(
      `INSERT INTO promos (owner_id, source, source_key, bookmaker, title, details, url, ends_at, found_at)
       VALUES (NULL, 'site', @sourceKey, @bookmaker, @title, @details, @url, @endsAt, @now)
       ON CONFLICT (source, source_key) DO UPDATE SET
         bookmaker = excluded.bookmaker, title = excluded.title, details = excluded.details,
         url = excluded.url, ends_at = excluded.ends_at`
    );
    for (const promo of promos) {
      if (!exists.get(promo.sourceKey)) added++;
      upsert.run({ ...promo, now: now.toISOString() });
    }
    const keys = promos.map((p) => p.sourceKey);
    const removed = db
      .prepare(`DELETE FROM promos WHERE source = 'site' AND bookmaker = ? AND source_key NOT IN (${keys.map(() => "?").join(", ")})`)
      .run(bookmaker, ...keys).changes;
    db.exec("COMMIT");
    return { added, removed: Number(removed) };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// The readers of the bookmakers' promotions pages, by bookmaker.
export type PromoReader = (now: Date) => Promise<SitePromo[]>;

// One bookmaker's read: its promotions saved, or why not (an error, or a
// read that found none, which removes nothing and is as suspect).
export interface SitePromoRead {
  bookmaker: string;
  ok: boolean;
  error?: string;
}

// Reads each bookmaker's promotions and saves them; one failing costs only
// its own (logged). Never throws. Each bookmaker's outcome is returned, for
// the admins' alert (src/alerts/sitePromos.ts).
export async function refreshSitePromos(
  db: DatabaseSync,
  readers: Readonly<Record<string, PromoReader>>,
  now = new Date()
): Promise<SitePromoRead[]> {
  const reads: SitePromoRead[] = [];
  for (const [bookmaker, read] of Object.entries(readers)) {
    try {
      const promos = await read(now);
      const { added, removed } = saveSitePromos(db, bookmaker, promos, now);
      if (added || removed) console.log(`[site-promos] ${bookmaker}: ${added} new, ${removed} gone`);
      reads.push(promos.length > 0 ? { bookmaker, ok: true } : { bookmaker, ok: false, error: "no promotion found" });
    } catch (err) {
      console.error(`[site-promos] ${bookmaker}: could not read its promotions:`, err);
      reads.push({ bookmaker, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return reads;
}
