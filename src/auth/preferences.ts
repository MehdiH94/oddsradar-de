import { DatabaseSync } from "node:sqlite";
import { ALL_BOOKMAKER_IDS } from "../alerts/gems";

// What the dashboard keeps for an account, so that it finds its filters on
// every device (web/src/preferences.ts). The page, the search and the open
// match stay per tab and are not here.
export interface Preferences {
  sport: string;
  sort: "trj" | "start" | "value";
  // The ticked bookmakers in ALL_BOOKMAKER_IDS' order. Empty means none, which
  // is not the same as never chosen: that is no preferences at all.
  bookmakers: string[];
  players: boolean;
  favoriteSports: string[];
}

export const MAX_FAVORITE_SPORTS = 3;

// A sport's name as the scrapers write it ("football", "value-bets").
const NAME = /^[a-z0-9-]{1,64}$/;
const SORTS = ["trj", "start", "value"] as const;

const isName = (value: unknown): value is string => typeof value === "string" && NAME.test(value);

// The body of a PUT, or null when it is not preferences. What the client could
// get wrong without bad intent (an unknown sort, a bookmaker that is gone) is
// corrected; what cannot be is refused.
export function parsePreferences(input: unknown): Preferences | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const { sport, sort, bookmakers, players, favoriteSports } = input as Record<string, unknown>;
  if (!isName(sport) || typeof players !== "boolean") return null;
  if (!Array.isArray(bookmakers) || !Array.isArray(favoriteSports)) return null;
  if (!favoriteSports.every(isName)) return null;
  return {
    sport,
    sort: SORTS.find((known) => known === sort) ?? "trj",
    bookmakers: ALL_BOOKMAKER_IDS.filter((id) => bookmakers.includes(id)),
    players,
    favoriteSports: [...new Set(favoriteSports as string[])].slice(0, MAX_FAVORITE_SPORTS),
  };
}

export function getPreferences(db: DatabaseSync, userId: string): Preferences | null {
  const row = db.prepare("SELECT data FROM user_preferences WHERE user_id = ?").get(userId) as { data: string } | undefined;
  if (!row) return null;
  // Written by savePreferences only, but read through the same checks: a row
  // from an older shape must not reach the page.
  try {
    return parsePreferences(JSON.parse(row.data));
  } catch {
    return null;
  }
}

export function savePreferences(db: DatabaseSync, userId: string, preferences: Preferences, now = new Date()): void {
  db.prepare(
    `INSERT INTO user_preferences (user_id, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
  ).run(userId, JSON.stringify(preferences), now.toISOString());
}
