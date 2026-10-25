// How far ahead the exchange's main markets are read (./run.ts for football's
// 1X2, ./sportsRun.ts for the other head-to-head sports'): the owner wants
// its price on every match the site lists (25/10/2026), and bookmakers list
// them up to a week ahead. The matches of the next 48 hours are read every
// cycle; those further ahead, whose prices move slowly, less often, to keep
// the exchange's requests in check.

const HOUR_MS = 60 * 60 * 1000;

// Matches starting within this window are read.
export const REFERENCE_HORIZON_MS = 7 * 24 * HOUR_MS;
// Within this one, every cycle, their players' markets too.
export const NEAR_HORIZON_MS = 48 * HOUR_MS;
// A match further ahead is priced again this long after it last was: every
// other 5-minute cycle, with a minute to spare for a late cycle, under the 15
// minutes a price is shown for (DEFAULT_ODDS_MAX_AGE_MS, three cycles), so
// that it never goes blank between two reads.
export const FAR_PRICE_INTERVAL_MS = 9 * 60 * 1000;
// And searched again this long after it was not found (the near ones: half
// an hour).
export const NEAR_RETRY_NOT_FOUND_MS = 30 * 60 * 1000;
export const FAR_RETRY_NOT_FOUND_MS = 2 * HOUR_MS;

export function isNear(startTime: string, now: number): boolean {
  return Date.parse(startTime) - now <= NEAR_HORIZON_MS;
}

// Whether a match not found on the exchange is searched again now.
export function dueForSearch(target: { eventId: string; startTime: string }, now: number, searchedAt: Map<string, number>): boolean {
  const retry = isNear(target.startTime, now) ? NEAR_RETRY_NOT_FOUND_MS : FAR_RETRY_NOT_FOUND_MS;
  return now - (searchedAt.get(target.eventId) ?? 0) >= retry;
}

// Whether a match found on the exchange is priced this cycle: a near one
// always, a far one once its interval is over. A far one is marked as priced
// here, the near ones forgotten.
export function dueForPrice(target: { eventId: string; startTime: string }, now: number, pricedAt: Map<string, number>): boolean {
  if (isNear(target.startTime, now)) {
    pricedAt.delete(target.eventId);
    return true;
  }
  if (now - (pricedAt.get(target.eventId) ?? 0) < FAR_PRICE_INTERVAL_MS) return false;
  pricedAt.set(target.eventId, now);
  return true;
}
