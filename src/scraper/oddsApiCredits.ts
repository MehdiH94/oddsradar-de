import { readFileSync } from "node:fs";
import { MIN_CREDITS_LEFT, ODDS_API_BOOKMAKERS, ODDS_API_CACHE_FILE, OddsApiCache } from "./oddsApi";
import type { BookmakerPace } from "../db/bookmakerStatus";

// The Odds API's credits left this month (Tipico's, Winamax's and Pinnacle's
// prices, ./oddsApi.ts), as the worker last heard them, from its cache file:
// shown by `npm run bookmaker-status` (vps-report bookmakers) and the admin
// "Bookmakers" tab, so that the month's pace can be followed without the
// worker's log.
export interface OddsApiCredits {
  // Null until the API has told a count.
  creditsLeft: number | null;
  // When it was told.
  checkedAt: string | null;
  // At or under it, the worker reads no more until the credits renew.
  floor: number;
  // The refresh time the worker last used, paced to last the month
  // (./oddsApi.ts, pacedRefreshMs), in minutes; null before it set one.
  refreshMinutes: number | null;
}

// Null when the worker has never read The Odds API (no cache file: no key,
// or not yet run), or its file can't be read.
export function readOddsApiCredits(file = ODDS_API_CACHE_FILE): OddsApiCredits | null {
  let cache: OddsApiCache;
  try {
    cache = JSON.parse(readFileSync(file, "utf8")) as OddsApiCache;
  } catch {
    return null;
  }
  return {
    creditsLeft: typeof cache.creditsLeft === "number" ? cache.creditsLeft : null,
    checkedAt: typeof cache.creditsCheckedAt === "string" ? cache.creditsCheckedAt : null,
    floor: MIN_CREDITS_LEFT,
    refreshMinutes: typeof cache.refreshMinutes === "number" ? cache.refreshMinutes : null,
  };
}

// One line for `npm run bookmaker-status`.
export function formatOddsApiCredits(credits: OddsApiCredits | null, now = Date.now()): string {
  const head = "The Odds API (tipico, winamaxde, Pinnacle):";
  if (!credits) return `${head} never read here (no cache file)`;
  if (credits.creditsLeft === null) return `${head} credits left not told yet`;
  const checked = credits.checkedAt ? `, checked ${Math.round((now - Date.parse(credits.checkedAt)) / 60_000)} min ago` : "";
  const spent = credits.creditsLeft <= credits.floor ? `; at or under the floor of ${credits.floor}: no reads until they renew` : "";
  const pace = credits.refreshMinutes !== null && !spent ? `; a read every ${credits.refreshMinutes} min` : "";
  return `${head} ${credits.creditsLeft} credits left${checked}${pace}${spent}`;
}

// The Odds API's bookmakers' pace, from the refresh time the worker last used:
// between two paced reads they give no price, which is no failure
// (src/db/bookmakerStatus.ts, healthOf). Empty before a pace was set.
export function oddsApiPace(credits: OddsApiCredits | null): BookmakerPace {
  const minutes = credits?.refreshMinutes;
  if (typeof minutes !== "number" || !(minutes > 0)) return {};
  return Object.fromEntries(Object.values(ODDS_API_BOOKMAKERS).map((id) => [id, minutes * 60_000]));
}
