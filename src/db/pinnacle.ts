import { DatabaseSync } from "node:sqlite";
import { Outcome } from "../reference/exchange";
import { listedTheOtherWay } from "../reference/match";

// Pinnacle's 1X2 of our football matches (src/reference/pinnacleRun.ts), and
// the fair odds made of it: the reference the site shows when fresh, the
// exchange's otherwise (src/db/reference.ts, loadReferences).

const OUTCOMES: Outcome[] = ["1", "X", "2"];

export interface PinnacleOdds {
  pinnacleId: string;
  // Our participants, in the order "1" and "2" stand for.
  participants: string[];
  price: Record<Outcome, number>;
  fair: Record<Outcome, number>;
}

export function savePinnacleOdds(db: DatabaseSync, eventId: string, odds: PinnacleOdds, scrapedAt: string): void {
  const insert = db.prepare(
    `INSERT INTO pinnacle_odds (event_id, selection, price, fair, pinnacle_id, participants, scraped_at)
     VALUES (@eventId, @selection, @price, @fair, @pinnacleId, @participants, @scrapedAt)
     ON CONFLICT (event_id, selection) DO UPDATE SET price = excluded.price, fair = excluded.fair,
       pinnacle_id = excluded.pinnacle_id, participants = excluded.participants, scraped_at = excluded.scraped_at`
  );
  for (const selection of OUTCOMES) {
    insert.run({
      eventId,
      selection,
      price: odds.price[selection],
      fair: odds.fair[selection],
      pinnacleId: odds.pinnacleId,
      participants: JSON.stringify(odds.participants),
      scrapedAt,
    });
  }
}

export interface PinnacleReference {
  // Pinnacle's prices and the fair odds made of them, by outcome.
  price: Record<Outcome, number>;
  fair: Record<Outcome, number>;
  scrapedAt: string;
}

// The given events' Pinnacle 1X2 read since `since`, with all three
// outcomes, oriented on the events' participants as they are listed now: a
// match whose sides are now the other way round from when its prices were
// saved gets its "1" and "2" swapped (src/reference/match.ts,
// listedTheOtherWay).
export function loadPinnacleReferences(db: DatabaseSync, ids: readonly string[], since: string): Map<string, PinnacleReference> {
  const references = new Map<string, PinnacleReference>();
  for (let start = 0; start < ids.length; start += 500) {
    const params: Record<string, string> = { since };
    const placeholders = ids.slice(start, start + 500).map((id, i) => {
      params[`id${i}`] = id;
      return `@id${i}`;
    });
    const rows = db
      .prepare(
        `SELECT p.event_id AS eventId, p.selection, p.price, p.fair, p.participants, p.scraped_at AS scrapedAt,
                e.participants AS listed
         FROM pinnacle_odds p JOIN events e ON e.id = p.event_id
         WHERE p.event_id IN (${placeholders.join(", ")}) AND p.scraped_at >= @since`
      )
      .all(params) as unknown as {
      eventId: string;
      selection: Outcome;
      price: number;
      fair: number;
      participants: string;
      scrapedAt: string;
      listed: string;
    }[];
    const partial = new Map<string, { price: Partial<Record<Outcome, number>>; fair: Partial<Record<Outcome, number>>; scrapedAt: string; swap: boolean }>();
    for (const row of rows) {
      const entry = partial.get(row.eventId) ?? {
        price: {},
        fair: {},
        scrapedAt: row.scrapedAt,
        swap: listedTheOtherWay(JSON.parse(row.participants), JSON.parse(row.listed)),
      };
      const selection = entry.swap && row.selection !== "X" ? (row.selection === "1" ? "2" : "1") : row.selection;
      entry.price[selection] = row.price;
      entry.fair[selection] = row.fair;
      if (row.scrapedAt < entry.scrapedAt) entry.scrapedAt = row.scrapedAt;
      partial.set(row.eventId, entry);
    }
    for (const [eventId, { price, fair, scrapedAt }] of partial) {
      if (OUTCOMES.every((o) => price[o] !== undefined && fair[o] !== undefined)) {
        references.set(eventId, { price: price as Record<Outcome, number>, fair: fair as Record<Outcome, number>, scrapedAt });
      }
    }
  }
  return references;
}
