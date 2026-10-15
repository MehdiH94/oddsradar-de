import { RawEvent, RawOdds } from "../types";
import { BookmakerScraper } from "./run";
import { canonicalMarketName, canonicalSport } from "./canonical";
import { validateRawEvent } from "./validateRawEvent";

// 20bet's prices, from the API its site reads them from (platform.20bet.com/
// api/event/list, seen in its pages' requests from a German IP, 15/10/2026,
// tests/scraper/fixtures/20bet-*.json): JSON GETs, without an account, a
// cookie or a token. The site sends German visitors to a mirror domain
// (20betz0ne1.com, 15/10/2026), whose API is the same; the main one answers
// from Germany too, and does not change.
//
// 20bet holds a Curaçao licence, not a German one (GGL): the user chose to
// list it anyway, knowing it (15/10/2026). It takes no German betting tax:
// its prices are stored as they are.
//
// A sport's events before kick-off, page after page, each with every market
// (the API has no filter on them: 40 KB an event, 2.7 KB gzipped); only the
// main one is read, in Sportradar's ids: the result (1X2) or the winner.

const API = "https://platform.20bet.com/api/event/list";

// The events before kick-off.
const PRE_MATCH = 0;
// Events a page: the API answers nothing above 150 (15/10/2026).
const PAGE_SIZE = 100;
// A page's every market is a few MB to parse: a sport's pages one at a time.
const REQUEST_DELAY_MS = 300;
// A stalled request must fail rather than hang: the worker's overlap guard
// would otherwise skip every later cycle, for every bookmaker.
const REQUEST_TIMEOUT_MS = 30_000;

// Sportradar's outcome ids of a result (1, X, 2) and of a winner (1, 2).
const RESULT_OUTCOMES: Readonly<Record<string, "home" | "draw" | "away">> = { "1": "home", "2": "draw", "3": "away" };
const WINNER_OUTCOMES: Readonly<Record<string, "home" | "away">> = { "4": "home", "5": "away" };

// The sports read, by 20bet's sport id (./canonical.ts maps it), with the
// Sportradar id of their main market. Market 1 is the result in regular time
// (football, ice hockey, handball, rugby: the project's 1X2); 219 the winner
// overtime included (basketball, American football), 186 the winner (tennis,
// volleyball), 251 the winner extra innings included (baseball). Only those
// verified on the site's answers (15/10/2026).
export const TWENTYBET_SPORTS: Readonly<Record<string, { market: number }>> = {
  "1": { market: 1 },
  "3": { market: 186 },
  "2": { market: 219 },
  "4": { market: 1 },
  "10": { market: 1 },
  "17": { market: 219 },
  "13": { market: 1 },
  "7": { market: 186 },
  "5": { market: 251 },
};

const HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-language": "en-GB",
  "accept-encoding": "gzip",
  origin: "https://20bet.com",
  referer: "https://20bet.com/",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
};

export interface TwentybetOutcome {
  // Sportradar's: "1", "2" (the draw), "3" for a result; "4", "5" for a winner.
  vendorOutcomeId?: string;
  odds?: number | null;
  // 1 when it can be bet on.
  active?: number;
}
export interface TwentybetMarket {
  // Sportradar's market id: 1 the result, 186, 219, 251 a winner...
  vendorMarketId?: number;
  // A line ("total=2.5", "hcp=-1.5"); none on a result or a winner.
  specifiers?: string | null;
  // 1 when open.
  status?: number;
  outcomes?: TwentybetOutcome[];
}
export interface TwentybetEvent {
  id: number;
  sportId?: number;
  leagueId?: number;
  // 0 before kick-off.
  status?: number;
  competitor1Id?: number | null;
  competitor2Id?: number | null;
  // The kick-off in UTC, "2026-10-20 16:45:00".
  time?: string;
}
export interface TwentybetListReply {
  data?: {
    page?: number;
    lastPage?: number;
    items?: TwentybetEvent[];
    relations?: {
      odds?: Record<string, TwentybetMarket[]>;
      competitors?: { id: number; name?: string }[];
      league?: { id: number; name?: string }[];
    };
  };
}

// The kick-off the API gives in UTC, as an ISO date.
const isoOf = (time: string): string => new Date(`${time.replace(" ", "T")}Z`).toISOString();

// The project's sport of an event. 20bet's rugby is both codes: its league
// names say which ("Rugby League World Cup. 2026", "European Champions Cup").
function sportOf(sportId: string, competition: string): string {
  if (sportId === "13" && /\brugby league\b/i.test(competition)) return "rugby à xiii";
  return canonicalSport("twentybet", sportId);
}

// A page of a sport's events as raw events: each event not yet started with
// its main market, labelled with the teams' names and "Draw" (the matcher
// reads them as 1, X and 2). A market closed, or with outcomes it does not
// know, leaves the event out.
export function parseTwentybetEvents(reply: TwentybetListReply, sportId: string): RawEvent[] {
  const config = TWENTYBET_SPORTS[sportId];
  if (!config) return [];
  const relations = reply.data?.relations ?? {};
  const competitors = new Map((relations.competitors ?? []).map((c) => [c.id, c.name?.trim()]));
  const leagues = new Map((relations.league ?? []).map((l) => [l.id, l.name?.trim() ?? ""]));
  const sides = config.market === 1 ? RESULT_OUTCOMES : WINNER_OUTCOMES;
  const expected = config.market === 1 ? 3 : 2;

  const events: RawEvent[] = [];
  for (const event of reply.data?.items ?? []) {
    try {
      if (event.status !== PRE_MATCH || String(event.sportId) !== sportId || !event.time) continue;
      const home = competitors.get(event.competitor1Id ?? -1);
      const away = competitors.get(event.competitor2Id ?? -1);
      if (!home || !away) continue;
      const market = (relations.odds?.[String(event.id)] ?? []).find((m) => m.vendorMarketId === config.market && !m.specifiers);
      const outcomes = market?.outcomes ?? [];
      if (!market || market.status !== 1 || outcomes.length !== expected) continue;
      const names = { home, draw: "Draw", away };
      const marketName = canonicalMarketName(expected);
      const odds: RawOdds[] = outcomes.map((o) => {
        const side = sides[o.vendorOutcomeId ?? ""];
        if (!side) throw new Error(`unexpected outcome "${o.vendorOutcomeId}"`);
        return { market: marketName, selection: names[side], price: o.active === 1 && typeof o.odds === "number" ? o.odds : NaN };
      });
      const competition = leagues.get(event.leagueId ?? -1) ?? "";
      const raw: RawEvent = {
        sport: sportOf(sportId, competition),
        competition,
        startTime: isoOf(event.time),
        participants: [home, away],
        odds,
        sourceId: String(event.id),
      };
      const checked = validateRawEvent(raw, "twentybet");
      if (checked) events.push(checked);
    } catch (err) {
      // One malformed event must not take down the rest of the page.
      console.warn(`[scraper:twentybet] failed to read event ${event?.id}, skipping it:`, err);
    }
  }
  return events;
}

export const twentybetListUrl = (sportId: string, page: number): string =>
  `${API}?lang=en&main=1&status_in[]=${PRE_MATCH}&oddsExists_eq=1&sportId_eq=${sportId}` +
  `&relations[]=odds&relations[]=competitors&relations[]=league&limit=${PAGE_SIZE}&page=${page}`;

async function getPage(sportId: string, page: number): Promise<TwentybetListReply> {
  const res = await fetch(twentybetListUrl(sportId, page), { headers: HEADERS, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`20bet event/list: HTTP ${res.status}`);
  return (await res.json()) as TwentybetListReply;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A sport's every event, page after page.
async function fetchSport(sportId: string): Promise<RawEvent[]> {
  const events: RawEvent[] = [];
  for (let page = 1; ; page++) {
    const reply = await getPage(sportId, page);
    await sleep(REQUEST_DELAY_MS);
    events.push(...parseTwentybetEvents(reply, sportId));
    if (page >= (reply.data?.lastPage ?? 1)) return events;
  }
}

export async function fetchTwentybet(): Promise<RawEvent[]> {
  const sports = Object.keys(TWENTYBET_SPORTS);
  const read = [];
  for (const sportId of sports) {
    read.push(await fetchSport(sportId).then((value) => ({ ok: true as const, value }), (reason) => ({ ok: false as const, reason })));
  }
  // Every sport failing is the bookmaker failing (runScrapeCycle retries it);
  // one failing costs only its own events.
  if (read.every((r) => !r.ok)) throw new Error("every twentybet sport failed");
  return read.flatMap((r, i) => {
    if (r.ok) return r.value;
    console.warn(`[scraper:twentybet] sport ${sports[i]} failed, skipping it:`, r.reason);
    return [];
  });
}

export const twentybetScraper: BookmakerScraper = { id: "twentybet", fetch: fetchTwentybet };
