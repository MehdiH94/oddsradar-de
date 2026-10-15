import { RawEvent, RawOdds } from "../types";
import { BookmakerScraper } from "./run";
import { BookmakerId, canonicalMarketName, canonicalSport, MARKET_OUTRIGHT, OUTRIGHT_SPORTS, verifiedSportNames } from "./canonical";
import { validateRawEvent } from "./validateRawEvent";
import { pool } from "./pool";

// Betify's prices, from the feed its sportsbook reads them from: Betby's
// (sptpub.com), a platform that several bookmakers share (captured 14/10/2026,
// tests/scraper/fixtures/betify-*.json). Plain JSON GETs, without an account, a
// cookie or a token; Cloudflare guards Betify's own pages but not this feed.
//
// Betify is not licensed by the ANJ: it is read like the others, but a site that
// cannot be bet on legally in France is one to show as such (see README).
//
// The path to the feed:
//   1. Betify's site tells its brand and the renderer script it loads
//      (POST /fr/sport/launch).
//   2. The renderer script names the API host (api-h-<hash>.sptpub.com): it
//      changes with the renderer's releases, so it is read each cycle, the host
//      known on 14/10/2026 being the one to fall back on.
//   3. <api>/api/v4/prematch/brand/<brand>/fr/0 lists the versions of the feed's
//      files, <api>/.../fr/<version> gives each: sports, tournaments and matches
//      with their markets' prices, the markets being numbers whose names and
//      outcomes <api>/api/v3/descriptions/brand/<brand>/markets/fr gives.

export interface BetbySite {
  id: Extract<BookmakerId, "betify">;
  // Betify's own API, which tells the brand and the renderer script.
  launchUrl: string;
  // Sent as the site's front does.
  origin: string;
  // The API host of the renderer on 14/10/2026.
  fallbackApi: string;
}

export const BETIFY: BetbySite = {
  id: "betify",
  launchUrl: "https://flex.betify10.sh/fr/sport/launch",
  origin: "https://betify10.sh",
  fallbackApi: "https://api-h-c7818b61-608.sptpub.com",
};

export const REQUEST_TIMEOUT_MS = 20_000;
// Files of the feed read at once: seven on 14/10/2026, 50 to 150 KB each.
const CONCURRENCY = 3;
export const LANG = "fr";

const HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-language": "fr-FR",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
};

export interface BetbyOutcome {
  // The decimal price, as text ("1.56").
  k?: string;
  // 1 when the outcome is blocked (its price is then "0.0").
  b?: number;
}
// A market's prices by variant ("" for a plain one, "total=2.5" for a line),
// then by outcome id.
export type BetbyMarketPrices = Record<string, Record<string, BetbyOutcome>>;
export interface BetbyEvent {
  desc: {
    scheduled: number;
    // "match", "tournament" (an outright), "stage".
    type: string;
    sport: string;
    tournament: string;
    competitors: { name: string }[];
    virtual?: boolean;
  };
  markets?: Record<string, BetbyMarketPrices>;
}
// One file of the feed.
export interface BetbyChunk {
  sports?: Record<string, { name: string }>;
  tournaments?: Record<string, { name: string }>;
  events?: Record<string, BetbyEvent>;
}
export interface BetbyMarketDescription {
  name: string;
  // How much each sport (by id) puts the market forward: the main one has the most.
  main_order?: Record<string, number>;
  // The specifiers a market's prices are told apart by ("total", "hcp"...): they are
  // not part of the key of its variants below.
  specifiers?: string[];
  // The outcomes of each variant: "{$competitor1}", "{$competitor2}" and "match nul".
  // A variant of a player's market has the player in its own name.
  variants?: Record<string, { name?: string; outcomes: { id: string; name: string }[] }[]>;
}
export type BetbyMarketDescriptions = Record<string, BetbyMarketDescription>;
// A match's own descriptions: the names of the outcomes the shared ones leave out (its players, its runners).
export interface BetbyEventDescriptions {
  markets?: Record<string, BetbyMarketDescription>;
}

// The renderer script's API host: "https://api-h-c7818b61-608.sptpub.com".
export function parseBetbyApiHost(script: string): string | undefined {
  return /https:\/\/api-[a-z0-9-]+\.sptpub\.com/.exec(script)?.[0];
}

const HOME = "{$competitor1}";
const AWAY = "{$competitor2}";
const DRAW_LABEL = "Match nul";

// A match's result or winner: "1x2", "Vainqueur", "Vainqueur (inclus
// prolongations)"; not a half's ("1re mi-temps - 1x2"), a set's ("Set 1 -
// vainqueur"), a double chance, nor a draw refunded ("Match nul remboursé"),
// whose draw is no loss (./canonical.ts, isResultMarketTitle).
const RESULT_MARKET = /^(1x2|vainqueur)(?![a-z])/i;

interface Shape {
  // The outcome ids and the labels they are read as, in the market's order.
  outcomes: { id: string; selection: (home: string, away: string) => string }[];
}

// The outcomes of a result market, home and away alone or with a draw; anything
// else is not one to compare.
function shapeOf(description: BetbyMarketDescription): Shape | null {
  const outcomes = description.variants?.[""]?.[0]?.outcomes ?? [];
  const read = outcomes.map((o) => ({
    id: o.id,
    selection: (home: string, away: string) => (o.name === HOME ? home : o.name === AWAY ? away : DRAW_LABEL),
    kind: o.name === HOME ? "home" : o.name === AWAY ? "away" : /nul/i.test(o.name) ? "draw" : "other",
  }));
  const kinds = read.map((o) => o.kind).sort().join();
  if (kinds !== "away,home" && kinds !== "away,draw,home") return null;
  return { outcomes: read };
}

// The market the site puts first for the sport: the one its description gives
// the most weight in the sport's id, ice hockey's result in regular time first
// (like Winamax's and the exchange's 1X2), its winner overtime and shoot-out
// included when that is all there is.
function mainMarket(
  event: BetbyEvent,
  sportName: string,
  descriptions: BetbyMarketDescriptions
): { prices: Record<string, BetbyOutcome>; shape: Shape } | null {
  const candidates = Object.entries(event.markets ?? {}).flatMap(([id, variants]) => {
    const description = descriptions[id];
    const prices = variants[""];
    const shape = description && RESULT_MARKET.test(description.name) && prices ? shapeOf(description) : null;
    return shape ? [{ prices, shape, weight: description.main_order?.[event.desc.sport] ?? -Infinity }] : [];
  });
  const regularTime = (c: { shape: Shape }) => (sportName === "hockey sur glace" && c.shape.outcomes.length === 3 ? 1 : 0);
  candidates.sort((a, b) => regularTime(b) - regularTime(a) || b.weight - a.weight);
  return candidates[0] ?? null;
}

// A playoff series (MLB's, WNBA's) is listed as a "match" of its own beside the games,
// in a tournament such as "Résultats de la série MLB (meilleur des 7 matchs)" or "WNBA
// Series Results (Best of 7 games)", with a winner market (186) that reads like a game's
// but prices the whole series. Not a league that only has "Série" in its name.
const SERIES_TOURNAMENT = /\bs[ée]ries?\b.*\b(meilleur des|best of) \d+/i;

function eventToRawEvent(
  id: string,
  event: BetbyEvent,
  chunk: Required<Pick<BetbyChunk, "sports" | "tournaments">>,
  descriptions: BetbyMarketDescriptions,
  verified: ReadonlySet<string>,
  nowMs: number
): RawEvent | null {
  const { desc } = event;
  // A match not started yet, between two sides, of a sport read for.
  if (desc.type !== "match" || desc.virtual || desc.scheduled * 1000 <= nowMs) return null;
  const sportName = chunk.sports[desc.sport]?.name;
  if (!sportName || !verified.has(sportName.trim().toLowerCase())) return null;
  const [home, away] = desc.competitors.map((c) => c.name?.trim());
  if (desc.competitors.length !== 2 || !home || !away) return null;
  const competition = chunk.tournaments[desc.tournament]?.name?.trim() ?? "";
  if (SERIES_TOURNAMENT.test(competition)) return null;

  const sport = canonicalSport("betify", sportName);
  const market = mainMarket(event, sport, descriptions);
  if (!market) return null;
  const marketName = canonicalMarketName(market.shape.outcomes.length);
  const odds: RawOdds[] = [];
  for (const outcome of market.shape.outcomes) {
    const price = market.prices[outcome.id];
    // A blocked outcome is no price: the others' alone would read as a part of a 1X2.
    if (!price || price.b || !(Number(price.k) > 1)) return null;
    odds.push({ market: marketName, selection: outcome.selection(home, away), price: Number(price.k) });
  }
  return {
    sport,
    competition,
    startTime: new Date(desc.scheduled * 1000).toISOString(),
    participants: [home, away],
    odds,
    sourceId: id,
  };
}

// --- the races and championships ------------------------------------------------

// A race, a championship or a tournament of the sports without head-to-heads is an
// event of its own kind ("tournament", "stage") with the title and a marker as its
// two "competitors" ("Tour of Guangxi", "Winner"), and the runners as the outcomes of
// its winner market: "Vainqueur" (2000000), or the "Pronostic libre du championnat"
// (534) of the championships of the skiing, the biathlon and the touring cars. Their
// names are in the event's own descriptions, not in the feed's files.
const OUTRIGHT_TYPES: ReadonlySet<string> = new Set(["tournament", "stage"]);
const WINNER_MARKETS: readonly string[] = ["2000000", "534"];
const WINNER_MARKER = /^(winner|gagnant|vainqueur)$/i;

// The canonical sport of an outright to read: not started, not virtual, of a sport
// whose main bet is a winner among N and that the feed names.
function outrightSport(event: BetbyEvent, sports: Record<string, { name: string }>, verified: ReadonlySet<string>, nowMs: number): string | undefined {
  const { desc } = event;
  if (!OUTRIGHT_TYPES.has(desc.type) || desc.virtual || desc.scheduled * 1000 <= nowMs) return undefined;
  if (desc.competitors.length !== 2 || !desc.competitors[0]?.name?.trim() || !WINNER_MARKER.test(desc.competitors[1]?.name?.trim() ?? "")) return undefined;
  const name = sports[desc.sport]?.name;
  if (!name || !verified.has(name.trim().toLowerCase())) return undefined;
  const sport = canonicalSport("betify", name);
  return OUTRIGHT_SPORTS.has(sport) && WINNER_MARKETS.some((m) => event.markets?.[m]) ? sport : undefined;
}

function mergedSports(chunks: readonly BetbyChunk[]) {
  return Object.assign({}, ...chunks.map((c) => c.sports ?? {})) as Record<string, { name: string }>;
}
const verifiedNames = () => new Set(verifiedSportNames("betify").map((name) => name.trim().toLowerCase()));

// The ids of the outrights worth asking the descriptions of, to name their runners.
export function outrightIds(chunks: readonly BetbyChunk[], nowMs: number = Date.now()): string[] {
  const sports = mergedSports(chunks);
  const verified = verifiedNames();
  const events = new Map<string, BetbyEvent>(chunks.flatMap((c) => Object.entries(c.events ?? {})));
  return [...events].filter(([, event]) => outrightSport(event, sports, verified, nowMs) !== undefined).map(([id]) => id);
}

// An outright as a winner market: its title and its runners, named by its descriptions.
function outrightToRawEvent(
  id: string,
  event: BetbyEvent,
  sport: string,
  tournaments: Record<string, { name: string }>,
  names: BetbyEventDescriptions
): RawEvent | null {
  const marketId = WINNER_MARKETS.find((m) => event.markets?.[m]);
  const prices = marketId === undefined ? undefined : event.markets?.[marketId];
  const [key] = Object.keys(prices ?? {});
  const variants = marketId === undefined ? undefined : names.markets?.[marketId]?.variants;
  const outcomes = (variants?.[key] ?? (Object.keys(variants ?? {}).length === 1 ? Object.values(variants!)[0] : undefined))?.[0]?.outcomes;
  if (!prices || !outcomes) return null;
  const odds: RawOdds[] = outcomes.flatMap((o): RawOdds[] => {
    const p = prices[key][o.id];
    const price = Number(p?.k);
    return p && !p.b && price > 1 && o.name.trim() ? [{ market: MARKET_OUTRIGHT, selection: o.name.trim(), price }] : [];
  });
  return {
    sport,
    competition: tournaments[event.desc.tournament]?.name?.trim() ?? "",
    startTime: new Date(event.desc.scheduled * 1000).toISOString(),
    participants: [event.desc.competitors[0].name.trim()],
    odds,
    sourceId: id,
  };
}

// The feed's files as raw events: the head-to-heads of the sports read for,
// their main market's prices labelled with the teams' names and "Match nul"
// (the matcher reads them as 1, X and 2, src/matcher/match.ts). A match listed
// by two files is read once. The races and championships (outrightIds) are read too
// when their own descriptions, by the event's id, are given.
export function parseBetbyEvents(
  chunks: readonly BetbyChunk[],
  descriptions: BetbyMarketDescriptions,
  nowMs: number = Date.now(),
  outrightNames: Readonly<Record<string, BetbyEventDescriptions>> = {}
): RawEvent[] {
  const merged = {
    sports: mergedSports(chunks),
    tournaments: Object.assign({}, ...chunks.map((c) => c.tournaments ?? {})) as Record<string, { name: string }>,
  };
  const events = new Map<string, BetbyEvent>(chunks.flatMap((c) => Object.entries(c.events ?? {})));
  const verified = verifiedNames();
  const raws: RawEvent[] = [];
  for (const [id, event] of events) {
    try {
      const sport = outrightSport(event, merged.sports, verified, nowMs);
      const names = outrightNames[id];
      const raw =
        sport === undefined
          ? eventToRawEvent(id, event, merged, descriptions, verified, nowMs)
          : names && outrightToRawEvent(id, event, sport, merged.tournaments, names);
      const checked = raw && validateRawEvent(raw, BETIFY.id);
      if (checked) raws.push(checked);
    } catch (err) {
      // One malformed match must not take down the rest of the feed.
      console.warn(`[scraper:${BETIFY.id}] failed to read event ${id}, skipping it:`, err);
    }
  }
  return raws;
}

export async function betbyGet<T>(url: string, init: RequestInit = {}, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...HEADERS, ...headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${BETIFY.id} ${new URL(url).pathname}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

// The renderer's API host: read from its script, or the one known when that
// script cannot be read or names none. The feed itself failing is what fails the
// cycle, with a host that no longer answers.
async function apiHost(site: BetbySite, script: string | undefined): Promise<string> {
  if (script) {
    try {
      const res = await fetch(script, { headers: HEADERS, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      const host = res.ok ? parseBetbyApiHost(await res.text()) : undefined;
      if (host) return host;
    } catch (err) {
      console.warn(`[scraper:${site.id}] failed to read the renderer script, using the known API host:`, err);
    }
  }
  return site.fallbackApi;
}

export interface BetbyFeed {
  api: string;
  brand: string;
}

// Where the site's feed is: its brand and the API host of its renderer.
export async function resolveBetbyFeed(site: BetbySite): Promise<BetbyFeed> {
  const launch = await betbyGet<{ result?: { brand_id?: string; script?: string } }>(
    site.launchUrl,
    { method: "POST", body: "{}" },
    { "content-type": "application/json", origin: site.origin, referer: `${site.origin}/` }
  );
  const brand = launch.result?.brand_id;
  if (!brand) throw new Error(`${site.id}: its launch call names no brand`);
  return { api: await apiHost(site, launch.result?.script), brand };
}

export async function fetchBetby(site: BetbySite): Promise<RawEvent[]> {
  const { api, brand } = await resolveBetbyFeed(site);

  const feed = `${api}/api/v4/prematch/brand/${brand}/${LANG}`;
  const index = await betbyGet<{ top_events_versions?: number[]; rest_events_versions?: number[] }>(`${feed}/0`);
  const versions = [...(index.top_events_versions ?? []), ...(index.rest_events_versions ?? [])];
  if (versions.length === 0) throw new Error(`${site.id}: its feed lists no file`);

  const [descriptions, read] = await Promise.all([
    betbyGet<BetbyMarketDescriptions>(`${api}/api/v3/descriptions/brand/${brand}/markets/${LANG}`),
    pool(versions, CONCURRENCY, (version) => betbyGet<BetbyChunk>(`${feed}/${version}`)),
  ]);
  // Every file failing is the bookmaker failing (runScrapeCycle retries it);
  // one failing costs only its own matches.
  if (read.every((r) => r.status === "rejected")) throw new Error(`every ${site.id} feed file failed`);
  const chunks = read.flatMap((r, i) => {
    if (r.status === "fulfilled") return [r.value];
    console.warn(`[scraper:${site.id}] feed file ${versions[i]} failed, skipping it:`, r.reason);
    return [];
  });
  // The races and championships name their runners in their own descriptions: one
  // request each, and one failing costs only its own event.
  const ids = outrightIds(chunks);
  const asked = await pool(ids, CONCURRENCY, (id) =>
    betbyGet<BetbyEventDescriptions>(`${api}/api/v3/descriptions/brand/${brand}/event/${id}/${LANG}`)
  );
  const outrightNames: Record<string, BetbyEventDescriptions> = {};
  asked.forEach((r, i) => {
    if (r.status === "fulfilled") outrightNames[ids[i]] = r.value;
    else console.warn(`[scraper:${site.id}] the descriptions of event ${ids[i]} failed, skipping it:`, r.reason);
  });
  return parseBetbyEvents(chunks, descriptions, Date.now(), outrightNames);
}

export const betifyScraper: BookmakerScraper = { id: BETIFY.id, fetch: () => fetchBetby(BETIFY) };
