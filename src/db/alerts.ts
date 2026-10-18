import { DatabaseSync } from "node:sqlite";

// The Discord alerts' storage (src/alerts/gems.ts): every gem sent, kept after
// kick-off, and the alerts' state.

export interface SentGem {
  eventId: string;
  market: string;
  selection: string;
  bookmaker: string;
  basis: string;
  price: number;
  fair: number;
  edge: number;
  // How it reads: the outcome ("PSG", a player), its market, its match.
  label: string;
  marketLabel: string;
  matchLabel: string;
  startTime: string;
  sentAt: string;
}

// "configured" ("1" or "0"), "hello_for" (the greeted webhook's fingerprint),
// "last_error", "last_error_at" and "pending" (confirmedAlerts).
export function getAlertState(db: DatabaseSync, key: string): string | undefined {
  const row = db.prepare("SELECT value FROM alert_state WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function setAlertState(db: DatabaseSync, key: string, value: string | undefined): void {
  if (value === undefined) db.prepare("DELETE FROM alert_state WHERE key = ?").run(key);
  else db.prepare("INSERT INTO alert_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

// The listing's prices as the last scrape cycle read them (src/scraper/run.ts
// saves a whole cycle at one time). A price it did not read again -- the
// bookmaker suspended or withdrew it, or its read failed -- stays on the site
// for three cycles (oddsMaxAgeForPollInterval), but is no longer one an alert
// can promise: 20bet suspends a market it mispriced and reprices it within
// minutes, and the old price made surebets that were gone when looked at
// (18/10/2026). A price the listing does not hold (a markets cycle's, the
// exchange's) is not this check's.
export function listingPrices(db: DatabaseSync): {
  latest: string | undefined;
  isCurrent: (eventId: string, bookmaker: string, market: string, selection: string, price: number) => boolean;
} {
  const latest = (db.prepare("SELECT MAX(scraped_at) AS latest FROM event_bookmaker_odds").get() as { latest: string | null })
    .latest ?? undefined;
  const select = db.prepare(
    `SELECT price, scraped_at AS scrapedAt FROM event_bookmaker_odds
     WHERE event_id = ? AND bookmaker_id = ? AND market = ? AND selection = ?`
  );
  return {
    latest,
    isCurrent: (eventId, bookmaker, market, selection, price) => {
      const row = select.get(eventId, bookmaker, market, selection) as { price: number; scrapedAt: string } | undefined;
      return !row || (row.scrapedAt === latest && Math.abs(row.price - price) < 1e-9);
    },
  };
}

// The alerts seen at the last scrape cycle and at the one before (alert_state
// "pending"). An alert goes out only once two cycles in a row have it: a price
// a bookmaker corrects within a cycle (five minutes) is never sent. Two runs
// on the same cycle's prices (the alerts run on their own schedule) are not
// two cycles: the second keeps what the first confirmed.
interface Pending {
  cycle: string;
  seen: string[];
  before: string[];
}

export function confirmedAlerts(db: DatabaseSync, cycle: string | undefined, keys: readonly string[]): Set<string> {
  if (!cycle) return new Set();
  let pending: Pending | undefined;
  try {
    pending = JSON.parse(getAlertState(db, "pending") ?? "null") ?? undefined;
  } catch {
    pending = undefined;
  }
  const before = pending?.cycle === cycle ? pending.before : (pending?.seen ?? []);
  setAlertState(db, "pending", JSON.stringify({ cycle, seen: [...keys], before } satisfies Pending));
  const seenBefore = new Set(before);
  return new Set(keys.filter((key) => seenBefore.has(key)));
}

// A surebet is stored under this selection, its combination of bets standing
// for the bookmaker (src/alerts/gems.ts).
export const SUREBET_SELECTION = "surebet";

// What an alert is sent once for: a match, a market (its title) and an outcome
// (a team, a player). Whoever offers the price is not part of it: the same
// outcome at another bookmaker is not another alert. A surebet is sent once
// per combination of bets, as another combination is another surebet.
export const gemKey = (g: Pick<SentGem, "eventId" | "market" | "selection" | "bookmaker">) =>
  g.selection === SUREBET_SELECTION ? `${g.eventId}|${g.market}|${g.selection}|${g.bookmaker}` : `${g.eventId}|${g.market}|${g.selection}`;

// The gems already sent among the given matches, as `gemKey` reads them (rows
// stored with a bookmaker, before it left the key, count as well).
export function sentGemKeys(db: DatabaseSync, eventIds: readonly string[]): Set<string> {
  const keys = new Set<string>();
  const select = db.prepare("SELECT event_id AS eventId, market, selection, bookmaker FROM gem_alerts WHERE event_id = ?");
  for (const id of new Set(eventIds)) {
    for (const row of select.all(id) as Pick<SentGem, "eventId" | "market" | "selection" | "bookmaker">[]) keys.add(gemKey(row));
  }
  return keys;
}

export function recordSentGems(db: DatabaseSync, gems: readonly SentGem[]): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO gem_alerts
       (event_id, market, selection, bookmaker, basis, price, fair, edge, label, market_label, match_label, start_time, sent_at)
     VALUES (@eventId, @market, @selection, @bookmaker, @basis, @price, @fair, @edge, @label, @marketLabel, @matchLabel, @startTime, @sentAt)`
  );
  db.exec("BEGIN");
  try {
    for (const g of gems) insert.run({ ...g });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// GET /api/alerts: whether the worker has a webhook, its last failure since
// the last message sent, and the last gems sent. Never the webhook itself.
export function getAlertStatus(
  db: DatabaseSync,
  limit = 20
): { configured: boolean; lastError: { at: string; message: string } | null; sent: SentGem[] } {
  const message = getAlertState(db, "last_error");
  const sent = db
    .prepare(
      `SELECT event_id AS eventId, market, selection, bookmaker, basis, price, fair, edge, label,
              market_label AS marketLabel, match_label AS matchLabel, start_time AS startTime, sent_at AS sentAt
       FROM gem_alerts ORDER BY sent_at DESC, edge DESC LIMIT ?`
    )
    .all(limit) as unknown as SentGem[];
  return {
    configured: getAlertState(db, "configured") === "1",
    lastError: message === undefined ? null : { at: getAlertState(db, "last_error_at") ?? "", message },
    sent,
  };
}
