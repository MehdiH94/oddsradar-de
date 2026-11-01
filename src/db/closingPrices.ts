import { DatabaseSync } from "node:sqlite";

// A taken surebet's closing prices (src/auth/takenSurebets.ts): each back at
// a bookmaker, its price as last read before kick-off, from the listing's or
// the markets cycle's prices, which keep each outcome's last read. Beating it
// (taken above it) is the usual sign of a good bet: the closing line value.
// The exchange's legs have none here (a lay's closing price would need the
// exchange's own last read, kept elsewhere).

export interface ClosingLeg {
  market: string;
  selection: string;
  source: string;
  side: "back" | "lay";
}

const QUERIES = [
  "SELECT price, scraped_at AS at FROM event_bookmaker_odds WHERE event_id = ? AND bookmaker_id = ? AND market = ? AND selection = ?",
  "SELECT price, scraped_at AS at FROM event_market_odds WHERE event_id = ? AND bookmaker_id = ? AND market = ? AND selection = ?",
];

// Null for a lay, the exchange, an outcome never read, or one last read after
// kick-off (a live price is no closing price).
export function closingPrice(db: DatabaseSync, eventId: string, startTime: string, leg: ClosingLeg): number | null {
  if (leg.side !== "back" || leg.source === "exchange") return null;
  for (const sql of QUERIES) {
    const row = db.prepare(sql).get(eventId, leg.source, leg.market, leg.selection) as { price: number; at: string } | undefined;
    if (row) return Date.parse(row.at) <= Date.parse(startTime) ? row.price : null;
  }
  return null;
}
