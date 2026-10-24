import { RawEvent, RawOdds } from "../types";
import { BookmakerScraper } from "./run";
import { canonicalMarketName } from "./canonical";
import { netOfStakeTax } from "./stakeTax";
import { teamName } from "./twentybet";
import { validateRawEvent } from "./validateRawEvent";

// neobet.de's prices (GGL-licensed), from the program its pages read
// (neobet.de/.sportsbet/program/matches, seen in its pages' requests from the
// German VPS, 24/10/2026, tests/scraper/fixtures/neobet-*.json): plain JSON
// GETs, without an account, a cookie or a token, answered outside Germany too.
//
// An answer holds at most 50 matches, and fills up with others when the
// filter has fewer: a sport is read region by region ("ES", "ENG", "EUR"...),
// and a region with 50 of its own league by league. No page parameter exists.
// Most regions have no match of a sport: which ones do is found by asking
// them all, for one sport a cycle, and kept for an hour, so that a cycle asks
// only the regions with matches.

const API = "https://neobet.de/.sportsbet/program/matches";

// The German betting tax neobet takes off a single bet's return, 5% (it pays
// it itself on combinations only, "gebührenfreie Wette": wettfreunde.net,
// eurosport.de, wettbasis.com, 24/10/2026; its terms are not readable outside
// Germany). The prices are stored net of it (./stakeTax.ts).
export const NEOBET_TAX = 0.05;

// Matches an answer, at most.
export const NEOBET_PAGE_SIZE = 50;
const REQUEST_DELAY_MS = 200;
// Requests at once.
const CONCURRENCY = 2;
// A stalled request must fail rather than hang: the worker's overlap guard
// would otherwise skip every later cycle, for every bookmaker.
const REQUEST_TIMEOUT_MS = 20_000;
// How long a sport's regions with matches are trusted before being looked for again.
const REGIONS_TTL_MS = 60 * 60 * 1000;

// The sports read, by the API's name: the project's sport (src/scraper/
// canonical.ts's names) and its main market's outcomes. The main market is the
// one of type "MatchWin" (a football handicap shares its key's form): a 1, X
// and 2 is the result in regular time ("Goal_RT_HC3W(0.0)", the project's
// 1X2), a 1 and 2 the winner, overtime included ("…_FT_HC2W(0.0)", ice
// hockey's only one). Rugby is left out: its name does not say which code.
// Verified on the program of 24/10/2026.
export const NEOBET_SPORTS: Readonly<Record<string, { sport: string; outcomes: 2 | 3 }>> = {
  Football: { sport: "football", outcomes: 3 },
  Tennis: { sport: "tennis", outcomes: 2 },
  Basketball: { sport: "basketball", outcomes: 2 },
  Icehockey: { sport: "hockey sur glace", outcomes: 2 },
  Handball: { sport: "handball", outcomes: 3 },
  AmericanFootball: { sport: "football américain", outcomes: 2 },
  Volleyball: { sport: "volley-ball", outcomes: 2 },
  Baseball: { sport: "baseball", outcomes: 2 },
  Darts: { sport: "fléchettes", outcomes: 2 },
};

// The API's regions: ISO codes, England, Scotland, Wales and Northern Ireland
// apart, "EUR" for the European cups, "INT" for the international ones. An
// unknown code answers the default list, as a region without a match does.
export const NEOBET_REGIONS: readonly string[] = (
  "DE ENG EUR INT ES IT FR NL PT SCO WAL NIR AT CH BE DK SE NO FI PL CZ SK HU RO BG GR TR RU UA HR RS SI BA " +
  "AL AM AZ BY CY EE FO GE IE IL IS LT LU LV MK MT MD ME KZ UZ US CA MX BR AR CL CO UY PY PE EC BO VE CR GT HN NI PA SV " +
  "DO JM AU NZ JP KR CN TH VN ID MY SG PH IN IR IQ KW QA SA AE OM JO EG MA DZ TN ZA GH KE CM SN TZ ZM NG AD KH MM"
).split(" ");

export interface NeobetOdds {
  // "1", "X" or "2" ("+" and "-" for an over/under).
  key?: string;
  odds?: number;
}
export interface NeobetMarket {
  key?: string;
  // "MatchWin", "Handicap", "OverUnder", "OddsBoost"...
  bettingType?: string;
  odds?: NeobetOdds[];
}
export interface NeobetMatch {
  // "NEO|FB-4091933".
  id?: string;
  begin?: string;
  sport?: string;
  region?: string;
  league?: string;
  home?: string;
  away?: string;
  // "Pregame" before kick-off, "Running" live.
  contestStatus?: { name?: string };
  betmarkets?: NeobetMarket[];
}

// An answer's matches as raw events: each match of the sport not yet started
// with its main market, labelled with the teams' names and "Draw" (the matcher
// reads them as 1, X and 2), the prices net of the tax.
export function parseNeobetMatches(matches: readonly NeobetMatch[], sportName: string): RawEvent[] {
  const config = NEOBET_SPORTS[sportName];
  if (!config) return [];
  const events: RawEvent[] = [];
  for (const match of matches) {
    try {
      if (match.sport !== sportName || match.contestStatus?.name !== "Pregame" || !match.begin || !match.id) continue;
      const competition = (match.league ?? "").trim();
      const home = match.home?.trim();
      const away = match.away?.trim();
      if (!home || !away) continue;
      const market = match.betmarkets?.find((m) => m.bettingType === "MatchWin");
      const prices = market?.odds ?? [];
      if (prices.length !== config.outcomes) continue;
      const names: Record<string, string> = { "1": teamName(home, competition), X: "Draw", "2": teamName(away, competition) };
      const marketName = canonicalMarketName(prices.length);
      const odds: RawOdds[] = prices.map((p) => {
        const selection = names[p.key ?? ""];
        if (!selection || (selection === "Draw" && config.outcomes === 2)) throw new Error(`unexpected outcome "${p.key}"`);
        const price = typeof p.odds === "number" && p.odds > 1 ? p.odds : NaN;
        return { market: marketName, selection, price: netOfStakeTax(price, NEOBET_TAX) };
      });
      const raw: RawEvent = {
        sport: config.sport,
        competition,
        startTime: new Date(match.begin).toISOString(),
        participants: [names["1"], names["2"]],
        odds,
        sourceId: match.id,
      };
      const checked = validateRawEvent(raw, "neobet");
      if (checked) events.push(checked);
    } catch (err) {
      // One malformed match must not take down the rest of the list.
      console.warn(`[scraper:neobet] failed to read match ${match?.id}, skipping it:`, err);
    }
  }
  return events;
}

export type NeobetGet = (params: Record<string, string>) => Promise<NeobetMatch[]>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getMatches(params: Record<string, string>): Promise<NeobetMatch[]> {
  const query = new URLSearchParams({ language: "en", license: "DE", ...params });
  const res = await fetch(`${API}?${query}`, {
    headers: { accept: "application/json", "accept-language": "en" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  // A league it does not find in the region ("Could not find match Ids").
  if (res.status === 400) return [];
  if (!res.ok) throw new Error(`neobet program: HTTP ${res.status}`);
  const body = (await res.json()) as unknown;
  return Array.isArray(body) ? (body as NeobetMatch[]) : [];
}

// Runs the tasks, a few at once.
async function inPool<T>(items: readonly T[], run: (item: T) => Promise<void>, concurrency: number): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length > 0) await run(queue.shift()!);
    })
  );
}

// A sport's matches in the given regions, by id; and the regions with some.
export async function readNeobetRegions(
  sportName: string,
  regions: readonly string[],
  opts: { get?: NeobetGet; delayMs?: number; concurrency?: number } = {}
): Promise<{ matches: Map<string, NeobetMatch>; regions: string[] }> {
  const get = opts.get ?? getMatches;
  const delayMs = opts.delayMs ?? REQUEST_DELAY_MS;
  const matches = new Map<string, NeobetMatch>();
  const found = new Set<string>();
  const ofRegion = (list: NeobetMatch[], region: string) => list.filter((m) => m.sport === sportName && m.region === region && m.id);
  await inPool(
    regions,
    async (region) => {
      const own = ofRegion(await get({ sport: sportName, region }), region);
      await sleep(delayMs);
      for (const m of own) matches.set(m.id!, m);
      if (own.length > 0) found.add(region);
      // A full answer may leave some out: its leagues one by one.
      if (own.length < NEOBET_PAGE_SIZE) return;
      for (const league of new Set(own.map((m) => m.league ?? "").filter(Boolean))) {
        for (const m of ofRegion(await get({ sport: sportName, region, league }), region)) matches.set(m.id!, m);
        await sleep(delayMs);
      }
    },
    opts.concurrency ?? CONCURRENCY
  );
  return { matches, regions: regions.filter((r) => found.has(r)) };
}

// Each sport's regions with matches, and when they were last looked for.
export interface NeobetRegionCache {
  bySport: Map<string, { regions: string[]; at: number }>;
}

// The sport whose regions are looked for this cycle: one never looked for
// first, then the one looked for longest ago, once its hour is over.
export function sportToSurvey(cache: NeobetRegionCache, now: number): string | undefined {
  let oldest: { sport: string; at: number } | undefined;
  for (const sport of Object.keys(NEOBET_SPORTS)) {
    const entry = cache.bySport.get(sport);
    if (!entry) return sport;
    if (now - entry.at >= REGIONS_TTL_MS && (!oldest || entry.at < oldest.at)) oldest = { sport, at: entry.at };
  }
  return oldest?.sport;
}

const regionCache: NeobetRegionCache = { bySport: new Map() };

export async function fetchNeobet(
  opts: { get?: NeobetGet; delayMs?: number; cache?: NeobetRegionCache; now?: () => number } = {}
): Promise<RawEvent[]> {
  const cache = opts.cache ?? regionCache;
  const now = (opts.now ?? Date.now)();
  const surveyed = sportToSurvey(cache, now);
  const sports = Object.keys(NEOBET_SPORTS).filter((s) => s === surveyed || cache.bySport.has(s));
  const read = [];
  // One sport after the other.
  for (const sport of sports) {
    const regions = sport === surveyed ? NEOBET_REGIONS : cache.bySport.get(sport)!.regions;
    read.push(
      await readNeobetRegions(sport, regions, opts).then(
        (value) => {
          if (sport === surveyed) cache.bySport.set(sport, { regions: value.regions, at: now });
          return { ok: true as const, value: parseNeobetMatches([...value.matches.values()], sport) };
        },
        (reason) => ({ ok: false as const, reason })
      )
    );
  }
  // Every sport failing is the bookmaker failing (runScrapeCycle retries it);
  // one failing costs only its own matches.
  if (read.length > 0 && read.every((r) => !r.ok)) throw new Error("every neobet sport failed");
  return read.flatMap((r, i) => {
    if (r.ok) return r.value;
    console.warn(`[scraper:neobet] sport ${sports[i]} failed, skipping it:`, r.reason);
    return [];
  });
}

export const neobetScraper: BookmakerScraper = { id: "neobet", fetch: () => fetchNeobet() };
