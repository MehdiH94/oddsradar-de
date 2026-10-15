import { DatabaseSync } from "node:sqlite";
import { RawEvent } from "../types";
import { matchEvents } from "../matcher/match";
import { upsertCanonicalEvents } from "../db/repository";

export interface BookmakerScraper {
  id: string;
  fetch: () => Promise<RawEvent[]>;
}

// The spec requires a simple retry (1-2 attempts) on a transient network
// failure before abandoning the cycle for that bookmaker. Both scrapers call a
// live bookmaker API over the network (a Socket.IO connection for Winamax, a
// streaming gRPC-Web POST per sport for Betclic), so a dropped connection or a
// timeout is common and usually transient; giving up on the first one drops a
// whole bookmaker's odds for the entire cycle. One retry is deliberately all
// this does -- each attempt re-requests every sport, so unbounded retries
// would hammer the bookmaker's API and could overrun the poll interval.
async function fetchWithRetry(scraper: BookmakerScraper, retries = 1): Promise<RawEvent[]> {
  try {
    return await scraper.fetch();
  } catch (err) {
    if (retries <= 0) throw err;
    console.warn(`[scraper:${scraper.id}] fetch failed, retrying once:`, err);
    return fetchWithRetry(scraper, retries - 1);
  }
}

export async function runScrapeCycle(db: DatabaseSync, scrapers: BookmakerScraper[]): Promise<void> {
  // Wrapping in `async (s) => s.fetch()` (not `(s) => s.fetch()`) matters: if a
  // scraper's fetch throws synchronously instead of returning a rejected promise
  // (a real risk -- BookmakerScraper's type doesn't enforce `async`), a bare
  // `.map((s) => s.fetch())` would throw out of the array construction itself,
  // before Promise.allSettled ever runs, losing every bookmaker's results for
  // the whole cycle instead of isolating just the one that failed. The async
  // wrapper still matters with fetchWithRetry in place: fetchWithRetry itself is
  // async, so it converts a synchronous throw into a rejection, but keeping the
  // wrapper preserves that guarantee independently of fetchWithRetry's shape.
  const results = await Promise.allSettled(scrapers.map(async (s) => fetchWithRetry(s)));

  const eventsByBookmaker: Record<string, RawEvent[]> = {};
  results.forEach((result, i) => {
    const scraper = scrapers[i];
    if (result.status === "fulfilled") {
      eventsByBookmaker[scraper.id] = result.value;
    } else {
      console.error(`[scraper:${scraper.id}] failed:`, result.reason);
    }
  });

  const canonicalEvents = matchEvents(eventsByBookmaker);
  upsertCanonicalEvents(db, canonicalEvents);
}
