import type { EventSort } from "./api";
import { ALL_BOOKMAKERS, DEFAULT_BOOKMAKERS, isDefaultBookmakers } from "./bookmakers";

export const DEFAULT_SPORT = "football";

// What the page shows, kept in its URL's query string so that a reload or a
// shared link lands on the same view. The keys are the ones fetchEvents sends
// to /api/events; the sport can be the value bets' category (VALUE_BETS).
export interface UrlFilters {
  sport: string;
  sort: EventSort;
  q: string;
  bookmakers: string[];
  // Only the matches with players' markets (MarketsMenu).
  players?: boolean;
  // Only one competition's matches and winner (CompetitionMenu).
  competition?: string;
  page: number;
  // A match's page open over the list, by its id (MatchPage).
  match?: string;
}

// Anything missing or invalid falls back to what the page shows by default.
// The sport is left as is: App checks it against the sports that have matches.
export function readUrlFilters(search: string): UrlFilters {
  const params = new URLSearchParams(search);
  const page = Number(params.get("page"));
  const bookmakers = params.get("bookmakers");
  return {
    sport: params.get("sport") || DEFAULT_SPORT,
    sort: params.get("sort") === "start" ? "start" : params.get("sort") === "value" ? "value" : "trj",
    q: params.get("q")?.trim() ?? "",
    // Absent: the default ones; empty: none. Unknown ids are dropped and the
    // order is ALL_BOOKMAKERS', like BookmakerMenu's.
    bookmakers:
      bookmakers === null
        ? [...DEFAULT_BOOKMAKERS]
        : ALL_BOOKMAKERS.filter((b) => bookmakers.split(",").includes(b)),
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    ...(params.get("players") === "1" ? { players: true } : {}),
    ...(params.get("competition")?.trim() ? { competition: params.get("competition")!.trim() } : {}),
    ...(params.get("match") ? { match: params.get("match")! } : {}),
  };
}

// The sport and the sort always show, the rest only when it differs from the
// default.
export function urlFiltersQuery(filters: UrlFilters): string {
  const params = new URLSearchParams({ sport: filters.sport, sort: filters.sort });
  if (filters.q) params.set("q", filters.q);
  if (!isDefaultBookmakers(filters.bookmakers)) params.set("bookmakers", filters.bookmakers.join(","));
  if (filters.players) params.set("players", "1");
  if (filters.competition) params.set("competition", filters.competition);
  if (filters.page > 1) params.set("page", String(filters.page));
  if (filters.match) params.set("match", filters.match);
  return params.toString();
}
