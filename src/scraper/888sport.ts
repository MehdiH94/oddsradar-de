import { RawEvent, RawOdds } from "../types";
import { BookmakerScraper } from "./run";
import { canonicalMarketName } from "./canonical";
import { netOfStakeTax } from "./stakeTax";
import { teamName } from "./twentybet";
import { validateRawEvent } from "./validateRawEvent";

// 888sport.de's prices (888's own platform, Spectate), from the API its pages
// read them from (spectate-web.888sport.de/spectate, seen in its pages'
// requests, 21/10/2026, tests/scraper/fixtures/888sport-*.json): without an
// account, no challenge in front of it. Two plain cookies the page's own
// script sets let a request through: the site's ("888Cookie", its language),
// without which the load balancer answers 403, and the version of the page's
// client ("spectate_client_ver", written in the page), without which the API
// answers 406. A first POST (load/state, the page's first request) opens an
// anonymous session, whose cookies the next requests carry, and says the
// German tax.
//
// A sport's matches before kick-off come by day: "today", "tomorrow" and
// "upcoming" (the days after, up to a week for football, four for the
// others), each a single answer with every match's main market.

const SITE = "https://www.888sport.de/";
const API = "https://spectate-web.888sport.de/spectate/";

// The site's own parameters for an anonymous visitor of the German site (its
// brand, its regulation), the names in English (the exchange's and the other
// bookmakers', src/matcher/).
const STATE_FORM: Readonly<Record<string, string>> = {
  currency_code: "EUR",
  language: "eng",
  sub_brand_id: "136",
  brand_id: "84",
  marketing_brand_id: "1",
  regulation_type_id: "12",
  timezone: "0",
  browsing_country_code: "DEU",
  product_package_id: "112",
  user_mode: "Anonymous",
  spectate_timezone: "UTC",
  device: "PC",
  referrer: "",
  theme_mode: "1",
};

// The client's version the page gave on 21/10/2026, should it not say it.
const CLIENT_VERSION = "2.175";

// The German betting tax 888sport.de takes: 5% of the return, as its session
// says (user.regulationTypeData.tax_on_returns, "0.05", 21/10/2026), its bet
// slip telling the same ("Im Gewinnfall werden 5% ... einbehalten"). A price
// pays price × (1 - tax): the prices are stored net of it.
export const SPORT888_TAX = 0.05;

const REQUEST_DELAY_MS = 300;
// A stalled request must fail rather than hang: the worker's overlap guard
// would otherwise skip every later cycle, for every bookmaker.
const REQUEST_TIMEOUT_MS = 30_000;

// The sports read, by the API's slug: the project's sport (src/scraper/
// canonical.ts's names) and its main market's name and outcomes, the first of
// them a match has (a 1, X and 2 is the result in ordinary time, the project's
// 1X2; a 1 and 2 the winner, overtime included). An ice hockey game has its
// result after 60 minutes in some lists, its money line in others. Verified
// on the matches of 21/10/2026.
export const SPORT888_SPORTS: Readonly<Record<string, { sport: string; markets: readonly { name: string; outcomes: 2 | 3 }[] }>> = {
  football: { sport: "football", markets: [{ name: "Match Winner", outcomes: 3 }] },
  tennis: { sport: "tennis", markets: [{ name: "To Win Match", outcomes: 2 }] },
  basketball: { sport: "basketball", markets: [{ name: "Money Line", outcomes: 2 }] },
  "ice-hockey": {
    sport: "hockey sur glace",
    markets: [
      { name: "60 Minutes Betting", outcomes: 3 },
      { name: "Money Line", outcomes: 2 },
    ],
  },
  "american-football": { sport: "football américain", markets: [{ name: "Money Line", outcomes: 2 }] },
  handball: { sport: "handball", markets: [{ name: "Match Result", outcomes: 3 }] },
  volleyball: { sport: "volley-ball", markets: [{ name: "Match Result", outcomes: 2 }] },
  darts: { sport: "fléchettes", markets: [{ name: "Match Winner", outcomes: 2 }] },
  "rugby-union": { sport: "rugby à xv", markets: [{ name: "Match Winner", outcomes: 3 }] },
  "rugby-league": { sport: "rugby à xiii", markets: [{ name: "Match Winner", outcomes: 3 }] },
};

// What an answer gives of a match, the rest left out. A market without a
// selection has them as an empty list.
export interface Sport888Selection {
  // "1" (the team the API orders first), "X" or "2".
  type?: string;
  decimal_price?: string;
  active?: boolean;
  tradable?: boolean;
  betable?: boolean;
}
export interface Sport888Event {
  id?: number;
  name?: string;
  start_time?: string;
  // "PENDING" before kick-off.
  event_status?: string;
  inplay?: boolean;
  // "NORMAL" before kick-off, "INPLAY" live.
  type?: string;
  active?: boolean;
  betable?: boolean;
  tournament_name?: string;
  competitors?: Record<string, { name?: string; order?: number; is_home_team?: boolean }>;
  markets?: Record<
    string,
    { name?: string; active?: boolean | null; tradable?: boolean | null; selections?: Record<string, Sport888Selection> | Sport888Selection[] }
  >;
}
export interface Sport888Reply {
  events?: Record<string, Sport888Event>;
}
// How many matches a sport has: live, today, tomorrow and on each later day.
export interface Sport888Digest {
  today?: number;
  tomorrow?: number;
  upcoming?: Record<string, number> | unknown[];
}

// A team's name as the other bookmakers write it: a women's team with "(W)"
// ("Sydney FC Women"), an age group's with its age (./twentybet.ts).
const nameOf = (raw: string, competition: string): string => teamName(raw.replace(/\s+Women$/i, " (W)").trim(), competition);

const priceOf = (s: Sport888Selection): number =>
  s.active === true && s.tradable === true && s.betable !== false ? Number(s.decimal_price) : NaN;

// A sport's answer as raw events: each match not yet started with its main
// market, labelled with the teams' names and "Draw" (the matcher reads them as
// 1, X and 2), the home team first, the prices net of the tax. A match without
// its main market open leaves the list.
export function parseSport888Events(reply: Sport888Reply, slug: string, tax = SPORT888_TAX): RawEvent[] {
  const config = SPORT888_SPORTS[slug];
  if (!config) return [];
  const events: RawEvent[] = [];
  for (const event of Object.values(reply.events ?? {})) {
    try {
      if (event.inplay !== false || event.event_status !== "PENDING" || event.type !== "NORMAL" || !event.start_time) continue;
      // An event's own "tradable" is false for most matches days ahead whose
      // prices are on offer (457 of 582 football matches, 21/10/2026): its
      // "betable" and its selections' flags say whether a bet is taken.
      if (event.active === false || event.betable === false) continue;
      const competition = (event.tournament_name ?? "").trim();
      const teams = Object.values(event.competitors ?? {});
      const byOrder = [1, 2].map((order) => teams.find((t) => t.order === order));
      if (teams.length !== 2 || !byOrder[0]?.name || !byOrder[1]?.name) continue;
      const [first, second] = byOrder.map((t) => nameOf(t!.name!, competition));
      // The home team first ("New England Patriots @ Chicago Bears" orders
      // the Bears first, and says so).
      const participants = byOrder[1]!.is_home_team && !byOrder[0]!.is_home_team ? [second, first] : [first, second];

      const markets = Object.values(event.markets ?? {});
      let found: { outcomes: 2 | 3; selections: Sport888Selection[] } | undefined;
      for (const wanted of config.markets) {
        const market = markets.find((m) => m.name === wanted.name);
        const selections = Object.values(market?.selections ?? {});
        if (market && selections.length === wanted.outcomes) {
          if (market.active === true && market.tradable === true) found = { outcomes: wanted.outcomes, selections };
          break;
        }
      }
      if (!found) continue;

      const sides: Record<string, string> = { "1": first, X: "Draw", "2": second };
      const prices = new Map<string, number>();
      for (const selection of found.selections) {
        const side = sides[selection.type ?? ""];
        if (!side || prices.has(side)) throw new Error(`unexpected selection "${selection.type}"`);
        prices.set(side, priceOf(selection));
      }
      if (prices.has("Draw") !== (found.outcomes === 3)) throw new Error("unexpected draw");

      const marketName = canonicalMarketName(found.outcomes);
      const odds: RawOdds[] = [...prices].map(([selection, price]) => ({ market: marketName, selection, price: netOfStakeTax(price, tax) }));
      const raw: RawEvent = {
        sport: config.sport,
        competition,
        startTime: new Date(event.start_time).toISOString(),
        participants,
        odds,
        sourceId: String(event.id),
      };
      const checked = validateRawEvent(raw, "888sport");
      if (checked) events.push(checked);
    } catch (err) {
      // One malformed match must not take down the rest of the list.
      console.warn(`[scraper:888sport] failed to read match ${event?.id}, skipping it:`, err);
    }
  }
  return events;
}

// The lists of a sport that hold matches, as its digest counts them.
export function sport888Periods(digest: Sport888Digest): string[] {
  const upcoming = digest.upcoming && !Array.isArray(digest.upcoming) ? Object.values(digest.upcoming) : [];
  return [
    ...((digest.today ?? 0) > 0 ? ["today"] : []),
    ...((digest.tomorrow ?? 0) > 0 ? ["tomorrow"] : []),
    ...(upcoming.some((n) => n > 0) ? ["upcoming"] : []),
  ];
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

interface Session {
  cookie: string;
  tax: number;
}

const headersOf = (cookie: string) => ({
  accept: "*/*",
  "accept-language": "de-DE",
  origin: "https://www.888sport.de",
  referer: SITE,
  "user-agent": UA,
  cookie,
});

const get = (url: string, init: RequestInit = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

// The site's client version, as its page writes it.
async function clientVersion(): Promise<string> {
  try {
    const res = await get(SITE, { headers: { "user-agent": UA, "accept-language": "de-DE" } });
    return /spectate_client_ver=([\d.]+)/.exec(await res.text())?.[1] ?? CLIENT_VERSION;
  } catch {
    return CLIENT_VERSION;
  }
}

// An anonymous session, as the page opens one: its cookies, and the tax.
async function openSession(): Promise<Session> {
  const base = `888Cookie=lang%3Dde; spectate_client_ver=${await clientVersion()}`;
  const form = new FormData();
  for (const [key, value] of Object.entries(STATE_FORM)) form.append(key, value);
  const res = await get(`${API}load/state`, { method: "POST", body: form, headers: headersOf(base) });
  if (!res.ok) throw new Error(`888sport load/state: HTTP ${res.status}`);
  const state = (await res.json()) as { user?: { regulationTypeData?: { tax_on_returns?: string } } };
  const said = Number(state.user?.regulationTypeData?.tax_on_returns);
  const cookies = res.headers.getSetCookie().map((c) => c.split(";")[0]);
  return { cookie: [base, ...cookies].join("; "), tax: said > 0 && said < 0.2 ? said : SPORT888_TAX };
}

async function apiGet<T>(session: Session, path: string, post = false): Promise<T> {
  const res = await get(`${API}${path}`, { method: post ? "POST" : "GET", ...(post ? { body: new FormData() } : {}), headers: headersOf(session.cookie) });
  if (!res.ok) throw new Error(`888sport ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A sport's matches: its digest, then each list that holds some.
async function fetchSport(session: Session, slug: string, delayMs: number): Promise<RawEvent[]> {
  const digest = await apiGet<Sport888Digest>(session, `eventsrequest/getEventsDigest/${slug}`);
  await sleep(delayMs);
  const events: RawEvent[] = [];
  for (const period of sport888Periods(digest)) {
    const reply = await apiGet<Sport888Reply>(session, `sportsbook-req/getUpcomingEvents/${slug}/${period}`, true);
    events.push(...parseSport888Events(reply, slug, session.tax));
    await sleep(delayMs);
  }
  return events;
}

export async function fetchSport888(opts: { delayMs?: number } = {}): Promise<RawEvent[]> {
  const session = await openSession();
  const sports = Object.keys(SPORT888_SPORTS);
  const read = [];
  // One sport after the other.
  for (const slug of sports) {
    read.push(await fetchSport(session, slug, opts.delayMs ?? REQUEST_DELAY_MS).then((value) => ({ ok: true as const, value }), (reason) => ({ ok: false as const, reason })));
  }
  // Every sport failing is the bookmaker failing (runScrapeCycle retries it);
  // one failing costs only its own matches.
  if (read.every((r) => !r.ok)) throw new Error("every 888sport sport failed");
  const seen = new Set<string>();
  return read.flatMap((r, i) => {
    if (!r.ok) {
      console.warn(`[scraper:888sport] sport ${sports[i]} failed, skipping it:`, r.reason);
      return [];
    }
    // "today" lists the first hours of tomorrow too.
    return r.value.filter((e) => !seen.has(e.sourceId ?? "") && seen.add(e.sourceId ?? ""));
  });
}

export const sport888Scraper: BookmakerScraper = { id: "888sport", fetch: () => fetchSport888() };
