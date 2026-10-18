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
// 20bet answers 429 (too many requests) when the production and the staging
// workers read it at once from the server's IP (16/10/2026): a second between
// pages, and a 429 waits as long as it asks (Retry-After) before one retry.
const REQUEST_DELAY_MS = 1_000;
const RATE_LIMITED_WAIT_MS = 10_000;
const MAX_RETRY_AFTER_MS = 30_000;
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
  // 20bet's own id, the one its boosts name (TwentybetBoost.outcomeId).
  id?: number;
  // Sportradar's: "1", "2" (the draw), "3" for a result; "4", "5" for a winner.
  vendorOutcomeId?: string;
  odds?: number | null;
  // 1 when it can be bet on.
  active?: number;
}
export interface TwentybetMarket {
  // 20bet's own id (621 its result), the one its boosts name.
  id?: number;
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

// A team's name with its side's marker, which 20bet leaves to the league's
// name: its youth teams play under the club's name alone ("Bern" against
// "Lausanne Academy" in the "Switzerland Championship U21", 16/10/2026), which
// the matcher reads as the first team, and paired with the first team's match
// on the exchange. The age ("Bern U21") or "(W)" for a women's league, as the
// other bookmakers write them, unless the name already says so.
export function teamName(name: string, competition: string): string {
  const age = /\bU[- ]?(\d{2})\b/i.exec(competition)?.[1];
  if (age && !/\bU[- ]?\d{2}\b/i.test(name)) return `${name} U${age}`;
  if (/\bwomen\b/i.test(competition) && !/\b(women|ladies)\b|\(w\)/i.test(name)) return `${name} (W)`;
  return name;
}

// 20bet's odds boosts: the outcomes it pays more on, from the request its pages
// make (platform.20bet.com/api/v4/boosted-odds, 18/10/2026: six, on the 1X2
// or the goals of football matches). A boost names its outcome by 20bet's own
// ids and says how much more it pays, not the price: the page works it out
// (boostedPrice).
const BOOSTS_API = "https://platform.20bet.com/api/v4/boosted-odds?lang=en&clientType=0&countryCode=DE";

export interface TwentybetBoost {
  eventId?: number;
  // 20bet's market and outcome ids (TwentybetMarket.id, TwentybetOutcome.id).
  marketId?: number;
  outcomeId?: number;
  specifiers?: string | null;
  // 1: the market's margin brought to marginBoost% (101: its prices pay 101%
  // in all); 2: the outcome's price times factorBoost.
  boostMethod?: number;
  marginBoost?: number | null;
  factorBoost?: number | null;
}

const BOOST_BY_MARGIN = 1;
const BOOST_BY_FACTOR = 2;

const isPrice = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;

// A market of two outcomes priced again to pay `payout`% in all, the ratio of
// their (price - 1) kept: 20bet's page's own computation (its module 86362,
// 18/10/2026), as it is.
function reprice2([x, y]: [number, number], payout: number): [number, number] {
  if (x > y) return reprice2([y, x], payout).reverse() as [number, number];
  const a = payout / 100;
  const d = (a * (y - 1)) / (x - 1);
  const c = ((y - 1) / (x - 1) + 1) * (a - 1);
  const low = (-c + (c ** 2 + 4 * d * (2 - a)) ** 0.5) / (2 * d) + 1;
  return [low, 1 / (a - 1 / low)];
}

// The same for three outcomes, the 1X2: the favourite's price first, from a
// cubic, then the two others as a market of two.
function reprice3(odds: number[], payout: number): number[] {
  const r = payout / 100;
  const low = Math.min(...odds);
  const lowAt = odds.indexOf(low);
  const high = Math.max(...odds);
  const highAt = odds.lastIndexOf(high);
  const midAt = 3 - lowAt - highAt;
  const mid = odds[midAt];
  const i = (mid - 1) / (low - 1);
  const u = (high - 1) / (low - 1);
  const f = i * u * r;
  const m = (i + u + i * u) * (r - 1);
  const p = (i + u + 1) * (r - 2);
  const b = (m ** 2 - 3 * f * p) / (3 * f ** 2);
  const q = (2 * m ** 3 - 9 * f * m * p - 27 * (3 - r) * f ** 2) / (27 * f ** 3);
  if ((q / 2) ** 2 - (b / 3) ** 3 >= 0) return odds;
  const g = Math.acos(q / (2 * (b / 3) ** 1.5));
  const first = -2 * (b / 3) ** 0.5 * Math.cos(g / 3 + (2 / 3) * Math.PI) - m / (3 * f) + 1;
  const [second, third] = reprice2([mid, high], (r - 1 / first) * 100);
  const out: number[] = [];
  out[lowAt] = first;
  out[midAt] = second;
  out[highAt] = third;
  return out;
}

// What a boost pays on its outcome, at the market's prices, rounded to the
// cent as the page shows it; none when it would not pay more than the price.
export function boostedPrice(boost: TwentybetBoost, odds: readonly number[], index: number): number | undefined {
  const price = odds[index];
  if (!isPrice(price) || !odds.every(isPrice)) return undefined;
  let boosted: number | undefined;
  if (boost.boostMethod === BOOST_BY_FACTOR) {
    boosted = isPrice(boost.factorBoost) && boost.factorBoost >= 1 ? price * boost.factorBoost : undefined;
  } else if (isPrice(boost.marginBoost)) {
    const repriced = odds.length === 3 ? reprice3([...odds], boost.marginBoost) : reprice2([odds[0], odds[1]], boost.marginBoost);
    boosted = repriced[index];
  }
  if (boosted === undefined || !Number.isFinite(boosted)) return undefined;
  const cents = Math.round(boosted * 100) / 100;
  return cents > price ? cents : undefined;
}

const boostKey = (eventId: number | undefined, marketId: number | undefined, outcomeId: number | undefined) =>
  `${eventId}:${marketId}:${outcomeId}`;

// A page of a sport's events as raw events: each event not yet started with
// its main market, labelled with the teams' names and "Draw" (the matcher
// reads them as 1, X and 2). A market closed, or with outcomes it does not
// know, leaves the event out.
export function parseTwentybetEvents(
  reply: TwentybetListReply,
  sportId: string,
  boosts: readonly TwentybetBoost[] = []
): RawEvent[] {
  const config = TWENTYBET_SPORTS[sportId];
  if (!config) return [];
  const relations = reply.data?.relations ?? {};
  const competitors = new Map((relations.competitors ?? []).map((c) => [c.id, c.name?.trim()]));
  const leagues = new Map((relations.league ?? []).map((l) => [l.id, l.name?.trim() ?? ""]));
  const sides = config.market === 1 ? RESULT_OUTCOMES : WINNER_OUTCOMES;
  const expected = config.market === 1 ? 3 : 2;
  // The boosts of a market without a line (the main one's).
  const boostOf = new Map(boosts.filter((b) => !b.specifiers).map((b) => [boostKey(b.eventId, b.marketId, b.outcomeId), b]));

  const events: RawEvent[] = [];
  for (const event of reply.data?.items ?? []) {
    try {
      if (event.status !== PRE_MATCH || String(event.sportId) !== sportId || !event.time) continue;
      const competition = leagues.get(event.leagueId ?? -1) ?? "";
      const homeName = competitors.get(event.competitor1Id ?? -1);
      const awayName = competitors.get(event.competitor2Id ?? -1);
      if (!homeName || !awayName) continue;
      const [home, away] = [teamName(homeName, competition), teamName(awayName, competition)];
      const market = (relations.odds?.[String(event.id)] ?? []).find((m) => m.vendorMarketId === config.market && !m.specifiers);
      const outcomes = market?.outcomes ?? [];
      if (!market || market.status !== 1 || outcomes.length !== expected) continue;
      const names = { home, draw: "Draw", away };
      const marketName = canonicalMarketName(expected);
      const prices = outcomes.map((o) => (typeof o.odds === "number" ? o.odds : NaN));
      const odds: RawOdds[] = outcomes.map((o, i) => {
        const side = sides[o.vendorOutcomeId ?? ""];
        if (!side) throw new Error(`unexpected outcome "${o.vendorOutcomeId}"`);
        const price = o.active === 1 && typeof o.odds === "number" ? o.odds : NaN;
        const boost = boostOf.get(boostKey(event.id, market.id, o.id));
        const boosted = boost && Number.isFinite(price) ? boostedPrice(boost, prices, i) : undefined;
        return { market: marketName, selection: names[side], price, ...(boosted !== undefined ? { boosted } : {}) };
      });
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// How long a 429 asks to wait: its Retry-After in seconds, within reason.
export function retryAfterMs(header: string | null): number {
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS) : RATE_LIMITED_WAIT_MS;
}

async function getPage(sportId: string, page: number, retried = false): Promise<TwentybetListReply> {
  const res = await fetch(twentybetListUrl(sportId, page), { headers: HEADERS, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (res.status === 429 && !retried) {
    await sleep(retryAfterMs(res.headers.get("retry-after")));
    return getPage(sportId, page, true);
  }
  if (!res.ok) throw new Error(`20bet event/list: HTTP ${res.status}`);
  return (await res.json()) as TwentybetListReply;
}

// A sport's every event, page after page.
async function fetchSport(sportId: string, boosts: readonly TwentybetBoost[]): Promise<RawEvent[]> {
  const events: RawEvent[] = [];
  for (let page = 1; ; page++) {
    const reply = await getPage(sportId, page);
    await sleep(REQUEST_DELAY_MS);
    events.push(...parseTwentybetEvents(reply, sportId, boosts));
    if (page >= (reply.data?.lastPage ?? 1)) return events;
  }
}

// The boosts of the moment; none when they fail to come: the prices still do.
async function fetchBoosts(): Promise<TwentybetBoost[]> {
  try {
    const res = await fetch(BOOSTS_API, { headers: { ...HEADERS, "x-bff": "1" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = ((await res.json()) as { data?: unknown }).data;
    return Array.isArray(data) ? (data as TwentybetBoost[]) : [];
  } catch (err) {
    console.warn("[scraper:twentybet] boosts failed, reading the prices without them:", err);
    return [];
  }
}

export async function fetchTwentybet(): Promise<RawEvent[]> {
  const sports = Object.keys(TWENTYBET_SPORTS);
  const boosts = await fetchBoosts();
  const read = [];
  for (const sportId of sports) {
    read.push(await fetchSport(sportId, boosts).then((value) => ({ ok: true as const, value }), (reason) => ({ ok: false as const, reason })));
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
