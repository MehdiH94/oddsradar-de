import { DEFAULT_BOOKMAKERS } from "./bookmakers";
import { VALUE_BETS } from "./sports";
import { urlFiltersQuery } from "./urlFilters";

// The site's two pages: the home (what CoteRadar is, and the way in) and the
// odds dashboard (the matches' prices and the value bets, App). The server
// answers the dashboard's path with the same index.html as the home's
// (SPA_PATHS in src/api/server.ts): change both together.
export const HOME_PATH = "/";
export const ODDS_PATH = "/cotes";

// The account pages. Each is also listed in SPA_PATHS (src/api/server.ts).
export const LOGIN_PATH = "/connexion";
export const REGISTER_PATH = "/inscription";
export const FORGOT_PATH = "/mot-de-passe-oublie";
export const RESET_PATH = "/reinitialiser-mot-de-passe";
export const VERIFY_PATH = "/confirmer-email";
// The administration, for admins only. Also listed in SPA_PATHS.
export const ADMIN_PATH = "/admin";
// The freebets' conversions, for accounts. Also listed in SPA_PATHS.
export const FREEBETS_PATH = "/freebets";
export const AUTH_PATHS: readonly string[] = [LOGIN_PATH, REGISTER_PATH, FORGOT_PATH, RESET_PATH, VERIFY_PATH];

// Where to go after signing in: the page that sent the visitor here, taken
// from ?next=. Only a path of this site: anything else ("//evil.example",
// "https://...", "/\\evil") would make the login form an open redirect.
export function safeNext(search: string): string | null {
  const next = new URLSearchParams(search).get("next");
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return null;
  if (AUTH_PATHS.some((path) => next === path || next.startsWith(`${path}?`))) return null;
  return next;
}

// The login page, remembering where to come back to.
export function loginHref(next?: string): string {
  return next ? `${LOGIN_PATH}?next=${encodeURIComponent(next)}` : LOGIN_PATH;
}

// The dashboard used to live at "/": its filters were in the query string, and
// the Discord alerts and the links people shared still point there. A "/" with
// one of its keys is the dashboard (Root sends it to ODDS_PATH); any other
// query ("?utm_source=...") stays on the home.
const DASHBOARD_KEYS = ["sport", "sort", "q", "bookmakers", "page", "players", "competition", "match"];

export function isDashboardQuery(search: string): boolean {
  const params = new URLSearchParams(search);
  return DASHBOARD_KEYS.some((key) => params.has(key));
}

// The dashboard at ODDS_PATH, on the value bets' list, biggest edge first,
// with the bookmakers it ticks by default.
export const valueBetsHref = `${ODDS_PATH}?${urlFiltersQuery({
  sport: VALUE_BETS,
  sort: "value",
  q: "",
  bookmakers: [...DEFAULT_BOOKMAKERS],
  page: 1,
})}`;

// The dashboard on football's matches, best TRJ first: its default.
export const oddsHref = ODDS_PATH;

// A match's page, opened from the value bets' list (its back link goes there).
export function matchHref(id: string): string {
  return `${ODDS_PATH}?${urlFiltersQuery({
    sport: VALUE_BETS,
    sort: "value",
    q: "",
    bookmakers: [...DEFAULT_BOOKMAKERS],
    page: 1,
    match: id,
  })}`;
}

const NAVIGATE_EVENT = "coteradar:navigate";

// Moves to another page without reloading: a new history entry (Back returns),
// and the listeners of onPathChange told.
export function navigate(href: string): void {
  window.history.pushState(null, "", href);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
  window.scrollTo?.({ top: 0 });
}

// Calls `listener` when the path may have changed: after navigate(), and with
// the browser's Back and Forward. Returns how to stop.
export function onPathChange(listener: () => void): () => void {
  window.addEventListener("popstate", listener);
  window.addEventListener(NAVIGATE_EVENT, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(NAVIGATE_EVENT, listener);
  };
}

// The page the address shows. An old dashboard link ("/?sport=tennis") is
// rewritten to ODDS_PATH on the way, keeping its query: the filters, the match
// and the hash are the dashboard's, only its path moved.
export function currentPath(): string {
  const { pathname, search, hash } = window.location;
  if (pathname === HOME_PATH && isDashboardQuery(search)) {
    window.history.replaceState(window.history.state, "", `${ODDS_PATH}${search}${hash}`);
    return ODDS_PATH;
  }
  // "/cotes/" is the dashboard too.
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}
