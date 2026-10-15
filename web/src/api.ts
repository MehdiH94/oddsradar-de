import { announceUnauthorized } from "./auth/session";
import type { EventDetail, EventWithOdds, Surebet, ValueBet } from "./types";

export interface EventsPage {
  events: EventWithOdds[];
  total: number;
  page: number;
  pageSize: number;
}

// The data routes need a session: a 401 means it ended (or never was), which
// the auth context hears (auth/session.ts) to send the visitor to the login.
export async function apiFetch(url: string): Promise<Response> {
  const res = await fetch(url);
  if (res.status === 401) announceUnauthorized();
  return res;
}

// "value": best edge over the reference first (football), see src/db/repository.ts.
export type EventSort = "trj" | "start" | "value";

export async function fetchEvents(
  opts: {
    sport?: string;
    q?: string;
    sort?: EventSort;
    // The bookmakers whose prices make up each match's TRJ; all when omitted.
    bookmakers?: readonly string[];
    // Only the matches with players' markets (scorers, assisters...).
    players?: boolean;
    // "all": the winners of the competitions (Ligue 1, Roland-Garros...) with
    // the matches. "competition": only the winners, of every sport.
    kind?: "competition" | "all";
    // Only this competition's events (see fetchCompetitions).
    competition?: string;
    page?: number;
    // 20 by default (the API's), at most 100.
    pageSize?: number;
  } = {}
): Promise<EventsPage> {
  const params = new URLSearchParams();
  if (opts.sport) params.set("sport", opts.sport);
  if (opts.q) params.set("q", opts.q);
  if (opts.sort) params.set("sort", opts.sort);
  // Sent even when empty: no bookmaker at all means no TRJ, not every bookmaker.
  if (opts.bookmakers) params.set("bookmakers", opts.bookmakers.join(","));
  if (opts.players) params.set("players", "1");
  if (opts.kind) params.set("kind", opts.kind);
  if (opts.competition) params.set("competition", opts.competition);
  if (opts.page) params.set("page", String(opts.page));
  if (opts.pageSize) params.set("pageSize", String(opts.pageSize));
  const qs = params.toString();
  const url = qs ? `/api/events?${qs}` : "/api/events";

  const res = await apiFetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.json();
}

// The API's pages: 20 matches by default, 100 at most.
export const PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// The first `count` matches (a multiple of PAGE_SIZE), for the phone's list
// that grows with "Voir plus" instead of turning pages. In one request up to
// 100; beyond, pages of 100, then the rest in pages of 20 (100 being a
// multiple of 20, their offsets line up).
export async function fetchFirstEvents(
  opts: Omit<NonNullable<Parameters<typeof fetchEvents>[0]>, "page" | "pageSize"> & { count: number }
): Promise<EventsPage> {
  const { count, ...filters } = opts;
  if (count <= MAX_PAGE_SIZE) {
    const first = await fetchEvents({ ...filters, page: 1, pageSize: count });
    return { ...first, page: 1, pageSize: count };
  }
  const requests: Array<{ page: number; pageSize: number }> = [];
  const full = Math.floor(count / MAX_PAGE_SIZE);
  for (let page = 1; page <= full; page++) requests.push({ page, pageSize: MAX_PAGE_SIZE });
  const perFull = MAX_PAGE_SIZE / PAGE_SIZE;
  for (let page = full * perFull + 1; page <= count / PAGE_SIZE; page++) requests.push({ page, pageSize: PAGE_SIZE });
  const pages = await Promise.all(requests.map((request) => fetchEvents({ ...filters, ...request })));
  // A match whose TRJ moved between two requests could come twice.
  const seen = new Set<string>();
  return {
    events: pages.flatMap((page) => page.events).filter((event) => !seen.has(event.id) && Boolean(seen.add(event.id))),
    total: pages[0].total,
    page: 1,
    pageSize: count,
  };
}

// "value": biggest edge first; "start": soonest kick-off first.
export type ValueBetSort = "value" | "start";

// Every value bet, all at once: a handful at most.
export async function fetchValueBets(
  opts: { q?: string; sort?: ValueBetSort; bookmakers?: readonly string[] } = {}
): Promise<{ bets: ValueBet[]; total: number; surebets?: Surebet[] }> {
  const params = new URLSearchParams();
  if (opts.q) params.set("q", opts.q);
  if (opts.sort) params.set("sort", opts.sort);
  // Like fetchEvents': sent even when empty, no bookmaker means no value bet.
  if (opts.bookmakers) params.set("bookmakers", opts.bookmakers.join(","));
  const qs = params.toString();
  const url = qs ? `/api/value-bets?${qs}` : "/api/value-bets";
  const res = await apiFetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.json();
}

export async function fetchSports(): Promise<string[]> {
  const res = await apiFetch("/api/sports");
  if (!res.ok) throw new Error(`GET /api/sports failed: ${res.status}`);
  return res.json();
}

// Null when the API doesn't know the match, or it has started.
export async function fetchEventDetail(id: string, opts: { bookmakers?: readonly string[] } = {}): Promise<EventDetail | null> {
  const params = new URLSearchParams();
  // Sent only when some bookmakers are unticked, like fetchEvents'.
  if (opts.bookmakers) params.set("bookmakers", opts.bookmakers.join(","));
  const qs = params.toString();
  const url = `/api/events/${encodeURIComponent(id)}${qs ? `?${qs}` : ""}`;
  const res = await apiFetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.json();
}

// The competitions a sport's list can be narrowed to (its matches' and its
// winners'), without their season.
export async function fetchCompetitions(sport: string): Promise<string[]> {
  const url = `/api/competitions?${new URLSearchParams({ sport })}`;
  const res = await apiFetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.json();
}

export async function fetchEventSuggestions(opts: {
  q: string;
  sport?: string;
  kind?: "competition" | "all";
  competition?: string;
}): Promise<string[]> {
  const params = new URLSearchParams({ q: opts.q });
  if (opts.sport) params.set("sport", opts.sport);
  if (opts.kind) params.set("kind", opts.kind);
  if (opts.competition) params.set("competition", opts.competition);
  const url = `/api/events/suggestions?${params}`;
  const res = await apiFetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.json();
}
