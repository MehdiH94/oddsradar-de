import { DatabaseSync } from "node:sqlite";
import { DEFAULT_ODDS_MAX_AGE_MS } from "../db/repository";
import { getReferenceTargets, saveReferenceMarkets } from "../db/reference";
import { loadFootballListings, saveFootballListing } from "../db/footballReference";
import { fetchExchangePrices, MarketPrices } from "./exchange";
import { fetchFootballMarkets, footballPoints, FootballMarkets } from "./football";
import { tennisPrices } from "./tennis";

// The reference for the other markets of football matches (totals, handicaps,
// both teams to score, scores...), after the 1X2's and the players' cycle
// (./run.ts) and the tennis one: each match that cycle has placed on the
// exchange has its markets listed every half hour (the exchange adds lines as
// the match nears), and priced every cycle. Their liquidity builds as the
// match nears: those starting within a day, the 25 nearest, a cycle (about 30
// markets each, 20 to a price socket).

const HORIZON_MS = 24 * 60 * 60 * 1000;
const MAX_MATCHES_PER_CYCLE = 25;
const MARKETS_REFRESH_MS = 30 * 60 * 1000;

export interface FootballMarketsReferenceOptions {
  markets?: (exchangeEventId: string) => Promise<FootballMarkets | undefined>;
  prices?: (markets: { marketId: string; eventId: string }[]) => Promise<Map<string, MarketPrices>>;
  now?: Date;
  oddsMaxAgeMs?: number;
}

export async function runFootballMarketsReferenceCycle(
  db: DatabaseSync,
  opts: FootballMarketsReferenceOptions = {}
): Promise<void> {
  const listMarkets = opts.markets ?? fetchFootballMarkets;
  const prices = opts.prices ?? ((markets) => fetchExchangePrices(markets));
  const now = (opts.now ?? new Date()).getTime();
  const placed = getReferenceTargets(db, {
    from: new Date(now).toISOString(),
    to: new Date(now + HORIZON_MS).toISOString(),
    oddsSince: new Date(now - (opts.oddsMaxAgeMs ?? DEFAULT_ODDS_MAX_AGE_MS)).toISOString(),
  })
    .filter((t) => t.source)
    .slice(0, MAX_MATCHES_PER_CYCLE);
  if (placed.length === 0) return;

  // Their markets, listed again every half hour; one that fails keeps the last
  // list, and a list of another exchange event than the one it is placed at is
  // no list.
  const listings = loadFootballListings(db, placed.map((t) => t.eventId));
  for (const target of placed) {
    const exchangeEventId = target.source!.exchangeEventId;
    const known = listings.get(target.eventId);
    if (known && known.exchangeEventId === exchangeEventId && now - Date.parse(known.listedAt) < MARKETS_REFRESH_MS) continue;
    try {
      const markets = await listMarkets(exchangeEventId);
      if (!markets) continue;
      const listing = { ...markets, exchangeEventId, listedAt: new Date(now).toISOString() };
      saveFootballListing(db, target.eventId, listing);
      listings.set(target.eventId, listing);
    } catch (err) {
      console.error(`[reference:football] markets of ${exchangeEventId} failed:`, err);
    }
  }

  const listed = placed.filter((t) => {
    const l = listings.get(t.eventId);
    return l !== undefined && l.exchangeEventId === t.source!.exchangeEventId && l.homeSelectionId !== undefined;
  });
  const read = listed.flatMap((t) =>
    listings.get(t.eventId)!.markets.map((m) => ({ marketId: m.marketId, eventId: t.source!.exchangeEventId }))
  );
  let outcomes = 0;
  let fair = 0;
  if (read.length > 0) {
    const markets = await prices(read);
    // The prices are as old as the end of their read.
    const scrapedAt = new Date().toISOString();
    for (const target of listed) {
      const listing = listings.get(target.eventId)!;
      // Our first team is the exchange's away side when the runner of our "1"
      // in the match odds is not its home side's.
      const reversed = target.source!.selections["1"] !== listing.homeSelectionId;
      const rows = tennisPrices(footballPoints(listing, reversed), markets);
      // Not answered this time: its last prices stay, and age out.
      if (rows.length === 0) continue;
      saveReferenceMarkets(db, target.eventId, rows, scrapedAt);
      outcomes += rows.length;
      fair += rows.filter((r) => r.fair !== undefined).length;
    }
  }
  console.log(
    `[reference:football] ${placed.length} matches within 24 h on the exchange, ${read.length} markets read, ${fair} of ${outcomes} outcomes with fair odds`
  );
}
