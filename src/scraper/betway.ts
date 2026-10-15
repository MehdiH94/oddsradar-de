import { RawEvent, RawOdds } from "../types";
import { BookmakerScraper } from "./run";
import { canonicalMarketName, canonicalSport } from "./canonical";
import { pool } from "./pool";
import { validateRawEvent } from "./validateRawEvent";

// Betway.de's prices, from the API its sports site reads them from
// (betway.de/de/api/sports/content/<method>, seen in its pages' requests from a
// German IP, 15/10/2026, tests/scraper/fixtures/betway-*.json): JSON POSTs,
// without an account, a cookie or a token, each body carrying the brand and the
// territory the site sends (BETWAY_CONTEXT).
//
// The path to the prices:
//   1. getEventsByCategory, a sport's every event id, by competition;
//   2. getEvents, a batch of those events with one market each (MarketCName):
//      the events, their markets and the markets' outcomes, as three lists.
// Only the main market of a match is read: its result (1X2) or its winner.

const API = "https://betway.de/de/api/sports/content";

// What the site sends in every request (Betway's brand on its German site).
export const BETWAY_CONTEXT = {
  BrandId: 3,
  LanguageId: 4,
  TerritoryId: 82,
  TerritoryCode: "DE",
  ClientTypeId: 2,
  JurisdictionId: 12,
  ClientIntegratorId: 1,
};

// The sports read, by Betway's category name, with the market each one's main
// one is asked by: football's and ice hockey's result in regular time (a draw
// possible, the project's 1X2 for both), the winner of a tennis or a
// basketball match. Only those verified on the site's answers (15/10/2026).
export const BETWAY_SPORTS: Readonly<Record<string, { market: string; outcomes: 2 | 3 }>> = {
  soccer: { market: "win-draw-win", outcomes: 3 },
  "ice-hockey": { market: "win-draw-win", outcomes: 3 },
  tennis: { market: "match-winner", outcomes: 2 },
  basketball: { market: "triplet-coupon-basketball", outcomes: 2 },
};

// The type of the market a match's main one is (a "triplet" asks for three:
// the winner, the handicap and the total).
const MAIN_TYPES = new Set(["win-draw-win", "to-win"]);
// Event ids a request: the site asks for 20 to 30 at once.
const BATCH_SIZE = 30;
// Requests at once, for one sport.
const CONCURRENCY = 2;
const REQUEST_DELAY_MS = 300;
// A stalled request must fail rather than hang: the worker's overlap guard
// would otherwise skip every later cycle, for every bookmaker.
const REQUEST_TIMEOUT_MS = 20_000;

const HEADERS = {
  accept: "application/json, text/plain, */*",
  "content-type": "application/json",
  "accept-language": "de-DE",
  origin: "https://betway.de",
  referer: "https://betway.de/de/sports",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
};

export interface BetwayEvent {
  Id: number;
  HomeTeamName?: string;
  AwayTeamName?: string;
  // The competition ("Bundesliga") and its country or family ("Deutschland").
  GroupName?: string;
  SubCategoryName?: string;
  // The kick-off, in milliseconds since the epoch.
  Milliseconds?: number;
  IsOutright?: boolean;
  IsLive?: boolean;
}
export interface BetwayMarket {
  Id: number;
  EventId: number;
  // "win-draw-win", "to-win", "handicap"...
  TypeCName?: string;
  IsSuspended?: boolean;
}
export interface BetwayOutcome {
  MarketId: number;
  // Which side it is: "1", "x" or "2" (football, tennis), "--home-team-",
  // "draw" or "--away-team-" (basketball, ice hockey), 15/10/2026.
  TeamCName?: string;
  OddsDecimal?: number;
  IsActive?: boolean;
}
export interface BetwayEventsReply {
  Events?: BetwayEvent[] | null;
  Markets?: BetwayMarket[] | null;
  Outcomes?: BetwayOutcome[] | null;
}

// An outcome's side, by its TeamCName in either of the site's spellings.
function sideOf(teamCName: string | undefined): "home" | "draw" | "away" | undefined {
  const name = (teamCName ?? "").toLowerCase();
  if (name === "1" || name.includes("home")) return "home";
  if (name === "2" || name.includes("away")) return "away";
  if (name === "x" || name === "draw") return "draw";
  return undefined;
}

// The events of a getEvents answer as raw events: each match not yet started
// with its main market, labelled with the teams' names and "Draw" (the
// matcher reads them as 1, X and 2). A market with another number of
// outcomes than its sport's, or an outcome the site no longer offers, leaves
// the match out of the comparison.
export function parseBetwayEvents(reply: BetwayEventsReply, category: string): RawEvent[] {
  const expected = BETWAY_SPORTS[category]?.outcomes;
  if (!expected) return [];
  const sport = canonicalSport("betway", category);
  const outcomesByMarket = new Map<number, BetwayOutcome[]>();
  for (const o of reply.Outcomes ?? []) {
    outcomesByMarket.set(o.MarketId, [...(outcomesByMarket.get(o.MarketId) ?? []), o]);
  }
  const mainByEvent = new Map<number, BetwayMarket>();
  for (const m of reply.Markets ?? []) {
    if (MAIN_TYPES.has(m.TypeCName ?? "") && !mainByEvent.has(m.EventId)) mainByEvent.set(m.EventId, m);
  }

  const events: RawEvent[] = [];
  for (const event of reply.Events ?? []) {
    try {
      const home = event.HomeTeamName?.trim();
      const away = event.AwayTeamName?.trim();
      const market = mainByEvent.get(event.Id);
      if (!home || !away || event.IsOutright || event.IsLive || !event.Milliseconds || !market || market.IsSuspended) continue;
      const outcomes = outcomesByMarket.get(market.Id) ?? [];
      if (outcomes.length !== expected) continue;
      const names = { home, draw: "Draw", away };
      const marketName = canonicalMarketName(outcomes.length);
      const odds: RawOdds[] = [];
      for (const o of outcomes) {
        const side = sideOf(o.TeamCName);
        if (!side || (side === "draw" && expected === 2)) throw new Error(`unexpected outcome "${o.TeamCName}"`);
        odds.push({ market: marketName, selection: names[side], price: o.IsActive ? Number(o.OddsDecimal) : NaN });
      }
      const raw: RawEvent = {
        sport,
        competition: event.GroupName?.trim() ?? "",
        startTime: new Date(event.Milliseconds).toISOString(),
        participants: [home, away],
        odds,
        sourceId: String(event.Id),
      };
      const checked = validateRawEvent(raw, "betway");
      if (checked) events.push(checked);
    } catch (err) {
      // One malformed event must not take down the rest of the batch.
      console.warn(`[scraper:betway] failed to read event ${event?.Id}, skipping it:`, err);
    }
  }
  return events;
}

export async function betwayPost<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ ...BETWAY_CONTEXT, CorrelationId: crypto.randomUUID(), ...params }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Betway ${method}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A sport's every event id, from its competitions.
async function eventIdsOf(category: string): Promise<number[]> {
  const reply = await betwayPost<{ Groups?: { Events?: number[] }[] }>("getEventsByCategory", { CategoryCName: category });
  return [...new Set((reply.Groups ?? []).flatMap((g) => g.Events ?? []))];
}

async function fetchSport(category: string): Promise<RawEvent[]> {
  const ids = await eventIdsOf(category);
  const batches = Array.from({ length: Math.ceil(ids.length / BATCH_SIZE) }, (_, i) => ids.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE));
  const read = await pool(batches, CONCURRENCY, async (batch) => {
    const reply = await betwayPost<BetwayEventsReply>("getEvents", {
      ExternalIds: batch,
      MarketCName: BETWAY_SPORTS[category].market,
      CategoryCName: category,
      IncludeAllMarkets: false,
      ScoreboardRequest: { IncidentRequest: {}, ScoreboardType: 3 },
    });
    await sleep(REQUEST_DELAY_MS);
    return parseBetwayEvents(reply, category);
  });
  if (batches.length > 0 && read.every((r) => r.status === "rejected")) throw new Error(`every betway ${category} batch failed`);
  return read.flatMap((r, i) => {
    if (r.status === "fulfilled") return r.value;
    console.warn(`[scraper:betway] a batch of ${category} failed (${batches[i].length} events), skipping it:`, r.reason);
    return [];
  });
}

export async function fetchBetway(): Promise<RawEvent[]> {
  const categories = Object.keys(BETWAY_SPORTS);
  const read = [];
  // One sport after the other: a sport's batches already run two at a time.
  for (const category of categories) {
    read.push(await fetchSport(category).then((value) => ({ ok: true as const, value }), (reason) => ({ ok: false as const, reason })));
  }
  // Every sport failing is the bookmaker failing (runScrapeCycle retries it);
  // one failing costs only its own matches.
  if (read.every((r) => !r.ok)) throw new Error("every betway sport failed");
  return read.flatMap((r, i) => {
    if (r.ok) return r.value;
    console.warn(`[scraper:betway] "${categories[i]}" failed, skipping it:`, r.reason);
    return [];
  });
}

export const betwayScraper: BookmakerScraper = { id: "betway", fetch: fetchBetway };
