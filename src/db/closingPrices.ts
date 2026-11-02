import { DatabaseSync } from "node:sqlite";
import { MARKET_1X2 } from "../scraper/canonical";

// A taken surebet's closing prices (src/auth/takenSurebets.ts): each leg's
// price as last read before kick-off. A bookmaker's back from the listing's
// or the markets cycle's prices, an exchange leg (a lay, or a back) from the
// exchange's own last read, its lay or back price: each table keeps an
// outcome's last read only. Beating it (a back taken above it, a lay below)
// is the usual sign of a good bet: the closing line value.

export interface ClosingLeg {
  market: string;
  selection: string;
  source: string;
  side: "back" | "lay";
}

const BOOKMAKER_QUERIES = [
  "SELECT price, scraped_at AS at FROM event_bookmaker_odds WHERE event_id = ? AND bookmaker_id = ? AND market = ? AND selection = ?",
  "SELECT price, scraped_at AS at FROM event_market_odds WHERE event_id = ? AND bookmaker_id = ? AND market = ? AND selection = ?",
];

// The exchange's prices of an outcome, as legReadAt (./surebets.ts) finds its read.
function exchangeRead(db: DatabaseSync, eventId: string, leg: ClosingLeg): { back: number | null; lay: number | null; at: string } | undefined {
  const rows: [string, unknown[]][] =
    leg.market === MARKET_1X2
      ? [["SELECT back, lay, scraped_at AS at FROM reference_odds WHERE event_id = ? AND selection = ?", [eventId, leg.selection]]]
      : [
          ["SELECT back, lay, scraped_at AS at FROM reference_markets WHERE event_id = ? AND market = ? AND selection = ?", [eventId, leg.market, leg.selection]],
          ["SELECT back, lay, scraped_at AS at FROM reference_player_odds WHERE event_id = ? AND market = ? AND player = ?", [eventId, leg.market, leg.selection]],
        ];
  for (const [sql, args] of rows) {
    const row = db.prepare(sql).get(...(args as string[])) as { back: number | null; lay: number | null; at: string } | undefined;
    if (row) return row;
  }
  return undefined;
}

// Null for an outcome never read, or one last read after kick-off (a live
// price is no closing price).
export function closingPrice(db: DatabaseSync, eventId: string, startTime: string, leg: ClosingLeg): number | null {
  const beforeStart = (at: string) => Date.parse(at) <= Date.parse(startTime);
  if (leg.source === "exchange") {
    const read = exchangeRead(db, eventId, leg);
    const price = read ? (leg.side === "lay" ? read.lay : read.back) : null;
    return read && typeof price === "number" && price > 1 && beforeStart(read.at) ? price : null;
  }
  if (leg.side !== "back") return null;
  for (const sql of BOOKMAKER_QUERIES) {
    const row = db.prepare(sql).get(eventId, leg.source, leg.market, leg.selection) as { price: number; at: string } | undefined;
    if (row) return beforeStart(row.at) ? row.price : null;
  }
  return null;
}
