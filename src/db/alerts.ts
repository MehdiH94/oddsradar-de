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
// "last_error" and "last_error_at".
export function getAlertState(db: DatabaseSync, key: string): string | undefined {
  const row = db.prepare("SELECT value FROM alert_state WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function setAlertState(db: DatabaseSync, key: string, value: string | undefined): void {
  if (value === undefined) db.prepare("DELETE FROM alert_state WHERE key = ?").run(key);
  else db.prepare("INSERT INTO alert_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
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
