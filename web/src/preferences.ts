import { apiFetch, type EventSort } from "./api";
import { announceUnauthorized } from "./auth/session";
import { readUrlFilters, type UrlFilters } from "./urlFilters";

// What the account keeps on the server (src/auth/preferences.ts), so that the
// dashboard opens on the same filters and favorites on every device. The page,
// the search and the open match stay the tab's own.
export interface Preferences {
  sport: string;
  sort: EventSort;
  bookmakers: string[];
  players: boolean;
  favoriteSports: string[];
}

const SORTS: readonly unknown[] = ["trj", "start", "value"];
const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

// The body of GET /api/preferences: the preferences, or null when nothing is
// saved yet or the answer isn't what was expected (a page must open anyway).
export function readPreferences(body: unknown): Preferences | null {
  const saved = (body as { preferences?: Partial<Record<keyof Preferences, unknown>> | null } | null)?.preferences;
  if (!saved || typeof saved !== "object") return null;
  const { sport, sort, bookmakers, players, favoriteSports } = saved;
  if (typeof sport !== "string" || !SORTS.includes(sort) || typeof players !== "boolean") return null;
  if (!isStrings(bookmakers) || !isStrings(favoriteSports)) return null;
  return { sport, sort: sort as EventSort, bookmakers, players, favoriteSports };
}

// Never rejects and never waits long: the dashboard opens on the URL's filters
// (or the defaults) when the server doesn't answer in time.
export async function loadPreferences(timeoutMs = 3000): Promise<Preferences | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const load = apiFetch("/api/preferences")
    .then((res) => (res.ok ? res.json().then(readPreferences) : null))
    .catch(() => null);
  try {
    return await Promise.race([load, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// True once the server has them. JSON, which the server requires of a write.
export async function savePreferences(preferences: Preferences): Promise<boolean> {
  try {
    const res = await fetch("/api/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(preferences),
    });
    if (res.status === 401) announceUnauthorized();
    return res.ok;
  } catch {
    return false;
  }
}

// What the address says about the filters themselves. A link names them (an
// alert's, a shared one) and must open as it is: the saved ones apply only to
// an address that names none of them.
const FILTER_KEYS = ["sport", "sort", "bookmakers", "players"];

export function mergeInitialFilters(search: string, preferences: Preferences | null): UrlFilters {
  const fromUrl = readUrlFilters(search);
  if (!preferences) return fromUrl;
  const params = new URLSearchParams(search);
  if (FILTER_KEYS.some((key) => params.has(key))) return fromUrl;
  // No "players" key in the address either: fromUrl has none to override.
  return {
    ...fromUrl,
    sport: preferences.sport,
    sort: preferences.sort,
    bookmakers: [...preferences.bookmakers],
    ...(preferences.players ? { players: true } : {}),
  };
}
