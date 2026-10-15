import { DatabaseSync } from "node:sqlite";
import { FootballMarkets } from "../reference/football";

// The football markets reference's storage (src/reference/footballRun.ts): the
// markets the exchange lists for a match it has placed (src/db/reference.ts,
// reference_sources), kept with the exchange's event they were listed for.

export interface FootballListing extends FootballMarkets {
  exchangeEventId: string;
  listedAt: string;
}

// The lists of the given matches, by event: those not listed yet are not there.
export function loadFootballListings(db: DatabaseSync, eventIds: readonly string[]): Map<string, FootballListing> {
  const listings = new Map<string, FootballListing>();
  const select = db.prepare(`SELECT markets, listed_at AS listedAt FROM reference_sources WHERE event_id = @eventId`);
  for (const eventId of new Set(eventIds)) {
    const row = select.get({ eventId }) as { markets: string | null; listedAt: string | null } | undefined;
    if (row?.markets && row.listedAt) listings.set(eventId, { ...JSON.parse(row.markets), listedAt: row.listedAt });
  }
  return listings;
}

export function saveFootballListing(db: DatabaseSync, eventId: string, listing: FootballListing): void {
  const { listedAt, ...markets } = listing;
  db.prepare(`UPDATE reference_sources SET markets = @markets, listed_at = @listedAt WHERE event_id = @eventId`).run({
    eventId,
    markets: JSON.stringify(markets),
    listedAt,
  });
}
