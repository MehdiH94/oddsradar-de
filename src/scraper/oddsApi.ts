import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { RawEvent, RawOdds } from "../types";
import { BookmakerScraper } from "./run";
import { BookmakerId, canonicalMarketName, canonicalSport } from "./canonical";
import { validateRawEvent } from "./validateRawEvent";
import { ODDS_API_PINNACLE, PinnacleMatch, pinnacleMatchesOf } from "../reference/pinnacle";

// Tipico's and Winamax.de's prices, which no request from the server reaches
// (Akamai and CloudFront refuse it), from The Odds API (the-odds-api.com), an
// odds data provider, under the user's own key (ODDS_API_KEY in .env, never
// printed), a competition's prices costing one credit. Each competition below
// is read every ODDS_API_REFRESH_MINUTES (15 by default: the user chose fresh
// prices over the free plan's 500 credits a month, 17/10/2026), only when it
// has matches within 48 hours (which the API's event list, free, tells), and
// never under MIN_CREDITS_LEFT; under it, the credits left are asked again
// every CREDITS_RECHECK_MS on the free sports list, so that the reads start
// again once the month's credits renew. Between two reads the last prices are returned
// again, from a file that a restart keeps; a competition not read for
// MAX_PRICE_AGE_MS (credits spent, the API down) is left out, so that no old
// price is shown or alerted on.
//
// The prices are the bookmakers' as the API gives them, with no German betting
// tax taken off: Tipico and Winamax.de both pay the tax themselves rather than
// take it off the stake or the winnings, so a price pays as shown (sport1.de,
// eurosport.de, wettbasis.com, buli-tipphilfe.de, 22/10/2026; their own terms
// could not be read from here). Like 20bet's, these prices need no
// netOfStakeTax.

const API = "https://api.the-odds-api.com/v4";

// Our bookmaker id by the API's.
export const ODDS_API_BOOKMAKERS: Readonly<Record<string, Extract<BookmakerId, "tipico" | "winamaxde">>> = {
  tipico_de: "tipico",
  winamax_de: "winamaxde",
};

// The competitions read, by the API's key, and our name for them.
export const ODDS_API_COMPETITIONS: Readonly<Record<string, string>> = {
  soccer_germany_bundesliga: "Bundesliga",
  soccer_germany_bundesliga2: "2. Bundesliga",
  soccer_epl: "Premier League",
  soccer_spain_la_liga: "LaLiga",
  soccer_italy_serie_a: "Serie A",
  soccer_france_ligue_one: "Ligue 1",
  soccer_uefa_champs_league: "UEFA Champions League",
};

const DEFAULT_REFRESH_MINUTES = 15;
// The oldest prices returned: twice the refresh time, half an hour at least.
const maxPriceAgeMs = (refreshMs: number) => Math.max(2 * refreshMs, 30 * 60 * 1000);
// A competition read only when it has a match within this horizon.
const HORIZON_MS = 48 * 60 * 60 * 1000;
// The last credits are kept: the month's plan is never overrun.
const MIN_CREDITS_LEFT = 20;
const REQUEST_TIMEOUT_MS = 20_000;
export const ODDS_API_CACHE_FILE = "./data/odds-api-cache.json";

export interface OddsApiOutcome {
  name?: string;
  price?: number;
}
export interface OddsApiEvent {
  id?: string;
  sport_key?: string;
  commence_time?: string;
  home_team?: string;
  away_team?: string;
  bookmakers?: { key?: string; last_update?: string; markets?: { key?: string; outcomes?: OddsApiOutcome[] }[] }[];
}

// The API's sport, from its key's first word, as ./canonical.ts maps it.
const sportOf = (sportKey: string, bookmaker: BookmakerId): string => canonicalSport(bookmaker, sportKey.split("_")[0]);

// A competition's events as one bookmaker's raw events: each match with that
// bookmaker's head-to-head prices, labelled with the teams' names and "Draw",
// as the API writes them (the matcher reads them as 1, X and 2).
export function parseOddsApiEvents(events: readonly OddsApiEvent[], bookmaker: Extract<BookmakerId, "tipico" | "winamaxde">): RawEvent[] {
  const apiKey = Object.entries(ODDS_API_BOOKMAKERS).find(([, id]) => id === bookmaker)?.[0];
  const out: RawEvent[] = [];
  for (const event of events) {
    try {
      const home = event.home_team?.trim();
      const away = event.away_team?.trim();
      const sportKey = event.sport_key ?? "";
      const book = event.bookmakers?.find((b) => b.key === apiKey);
      const outcomes = book?.markets?.find((m) => m.key === "h2h")?.outcomes ?? [];
      if (!home || !away || !event.commence_time || (outcomes.length !== 2 && outcomes.length !== 3)) continue;
      const marketName = canonicalMarketName(outcomes.length);
      const odds: RawOdds[] = outcomes.map((o) => {
        const name = o.name?.trim();
        const selection = name === home ? home : name === away ? away : name === "Draw" ? "Draw" : undefined;
        if (!selection) throw new Error(`unexpected outcome "${o.name}"`);
        return { market: marketName, selection, price: typeof o.price === "number" ? o.price : NaN };
      });
      const raw: RawEvent = {
        sport: sportOf(sportKey, bookmaker),
        competition: ODDS_API_COMPETITIONS[sportKey] ?? sportKey,
        startTime: event.commence_time,
        participants: [home, away],
        odds,
        sourceId: event.id,
      };
      const checked = validateRawEvent(raw, bookmaker);
      if (checked) out.push(checked);
    } catch (err) {
      console.warn(`[scraper:${bookmaker}] failed to read event ${event?.id}, skipping it:`, err);
    }
  }
  return out;
}

// The last read of each competition: when, and its events.
export interface OddsApiCache {
  competitions: Record<string, { readAt: string; events: OddsApiEvent[] }>;
  creditsLeft?: number;
  // When the credits left were last told by the API.
  creditsCheckedAt?: string;
}

// Under the floor, the credits are asked again this often, on the API's sports
// list, which costs none: without it, no read would ever tell that the month's
// credits renewed, and Tipico and Winamax would stay without prices.
export const CREDITS_RECHECK_MS = 6 * 60 * 60 * 1000;

export interface OddsApiOptions {
  key?: string;
  refreshMinutes?: number;
  cacheFile?: string;
  now?: () => number;
  fetch?: typeof fetch;
}

function readCache(file: string): OddsApiCache {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as OddsApiCache;
  } catch {
    return { competitions: {} };
  }
}

function writeCache(file: string, cache: OddsApiCache): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(cache));
  } catch (err) {
    console.warn("[scraper:odds-api] could not keep its last prices:", err);
  }
}

// The competitions due a read, reading them, and every competition's last
// events. Without a key, nothing: the staging site has none, so that only
// production spends the month's credits.
export async function loadOddsApi(opts: OddsApiOptions = {}): Promise<OddsApiEvent[]> {
  const key = opts.key ?? process.env.ODDS_API_KEY?.trim();
  if (!key) return [];
  const doFetch = opts.fetch ?? fetch;
  const now = (opts.now ?? Date.now)();
  const refreshMs = (opts.refreshMinutes ?? (Number(process.env.ODDS_API_REFRESH_MINUTES) || DEFAULT_REFRESH_MINUTES)) * 60 * 1000;
  const file = opts.cacheFile ?? ODDS_API_CACHE_FILE;
  const cache = readCache(file);
  const url = (path: string, params: Record<string, string> = {}) => {
    const u = new URL(API + path);
    u.searchParams.set("apiKey", key);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u;
  };
  let changed = false;
  if (cache.creditsLeft !== undefined && cache.creditsLeft <= MIN_CREDITS_LEFT) {
    const checked = Date.parse(cache.creditsCheckedAt ?? "");
    if (!Number.isFinite(checked) || now - checked >= CREDITS_RECHECK_MS) {
      try {
        const res = await doFetch(url("/sports"), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        const left = Number(res.headers.get("x-requests-remaining") ?? NaN);
        if (Number.isFinite(left)) {
          if (left > cache.creditsLeft) console.log(`[scraper:odds-api] credits renewed: ${left} left`);
          cache.creditsLeft = left;
        }
      } catch (err) {
        console.warn("[scraper:odds-api] could not ask for the credits left:", err);
      }
      // Asked, answered or not: the next ask waits CREDITS_RECHECK_MS.
      cache.creditsCheckedAt = new Date(now).toISOString();
      changed = true;
    }
  }
  for (const sportKey of Object.keys(ODDS_API_COMPETITIONS)) {
    const last = cache.competitions[sportKey];
    if (last && now - Date.parse(last.readAt) < refreshMs) continue;
    if (cache.creditsLeft !== undefined && cache.creditsLeft <= MIN_CREDITS_LEFT) {
      console.warn(`[scraper:odds-api] ${cache.creditsLeft} credits left this month: no more reads until they renew`);
      break;
    }
    try {
      // Free: the competition's events, to spend a credit only on one being played.
      const listRes = await doFetch(url(`/sports/${sportKey}/events`), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!listRes.ok) throw new Error(`events: HTTP ${listRes.status}`);
      const listed = (await listRes.json()) as OddsApiEvent[];
      const soon = listed.some((e) => {
        const at = Date.parse(e.commence_time ?? "");
        return at > now && at - now <= HORIZON_MS;
      });
      if (!soon) {
        cache.competitions[sportKey] = { readAt: new Date(now).toISOString(), events: [] };
        changed = true;
        continue;
      }
      const res = await doFetch(
        // Pinnacle's prices too, the fair odds' reference (src/reference/
        // pinnacle.ts): up to 10 bookmakers cost one credit, like two.
        url(`/sports/${sportKey}/odds`, {
          bookmakers: [...Object.keys(ODDS_API_BOOKMAKERS), ODDS_API_PINNACLE].join(","),
          markets: "h2h",
          oddsFormat: "decimal",
        }),
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
      );
      // No header is no count (Number(null) would read as 0 credits left).
      const left = Number(res.headers.get("x-requests-remaining") ?? NaN);
      if (Number.isFinite(left)) {
        cache.creditsLeft = left;
        cache.creditsCheckedAt = new Date(now).toISOString();
      }
      if (!res.ok) throw new Error(`odds: HTTP ${res.status}`);
      cache.competitions[sportKey] = { readAt: new Date(now).toISOString(), events: (await res.json()) as OddsApiEvent[] };
      changed = true;
      console.log(`[scraper:odds-api] ${sportKey} read, ${cache.creditsLeft ?? "?"} credits left`);
    } catch (err) {
      console.warn(`[scraper:odds-api] ${sportKey} failed, keeping its last prices:`, err);
    }
  }
  if (changed) writeCache(file, cache);
  // Only recent reads, and their matches still to start: a cached list ages.
  return Object.values(cache.competitions)
    .filter((c) => now - Date.parse(c.readAt) <= maxPriceAgeMs(refreshMs))
    .flatMap((c) => c.events)
    .filter((e) => Date.parse(e.commence_time ?? "") > now);
}

// One read a cycle for both bookmakers.
let inFlight: { at: number; promise: Promise<OddsApiEvent[]> } | null = null;
const loadOnce = (): Promise<OddsApiEvent[]> => {
  const now = Date.now();
  if (!inFlight || now - inFlight.at > 60_000) inFlight = { at: now, promise: loadOddsApi() };
  return inFlight.promise;
};

// Pinnacle's football 1X2 from the same reads, for the reference cycle
// (src/reference/pinnacleRun.ts).
export const pinnacleOddsApiMatches = async (): Promise<PinnacleMatch[]> => pinnacleMatchesOf(await loadOnce());

export const tipicoScraper: BookmakerScraper = { id: "tipico", fetch: async () => parseOddsApiEvents(await loadOnce(), "tipico") };
export const winamaxdeScraper: BookmakerScraper = { id: "winamaxde", fetch: async () => parseOddsApiEvents(await loadOnce(), "winamaxde") };
