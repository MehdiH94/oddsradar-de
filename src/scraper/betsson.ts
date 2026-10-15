import { RawEvent, RawOdds } from "../types";
import { BookmakerScraper } from "./run";
import {
  canonicalMarketName,
  canonicalSport,
  isResultMarketTitle,
  hasOutrights,
  MARKET_OUTRIGHT,
  verifiedSportNames,
} from "./canonical";
import { pool } from "./pool";
import { validateRawEvent } from "./validateRawEvent";

// Betsson's prices, from the content service its site reads them from
// (velsv-bson-ssb-pr.betsson.fr, captured 8/10/2026, tests/scraper/fixtures/
// betsson-*.json): JSON POSTs, without an account, a cookie or a token. The
// sports menu gives each sport's code, and a sport's list of matches (paged,
// from today on) carries every match's markets and prices.

const SERVICE_URL = "https://velsv-bson-ssb-pr.betsson.fr/services/content/get";
// The site's own id for its menu: the sports, with their codes.
const MENU_ID = "1355/top";
// The page size the site asks for (a football list is about 740 matches, 4
// pages; the outrights come after the matches).
const PAGE_SIZE = 200;
const MAX_PAGES = 20;
const PAGE_DELAY_MS = 300;
// How far ahead the site lists them.
const DAYS_AHEAD = 90;
// Sports read at once.
const CONCURRENCY = 2;
// A stalled request must fail rather than hang: the worker's overlap guard
// would otherwise skip every later cycle, for every bookmaker.
const REQUEST_TIMEOUT_MS = 20_000;

const HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/plain, */*",
  "accept-language": "fr-FR",
  origin: "https://betsson.fr",
  referer: "https://betsson.fr/",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
};

export interface BetssonSelection {
  name?: string;
  // The price as a fraction: up / down + 1 is the decimal price.
  currentpriceup?: string | null;
  currentpricedown?: string | null;
}
export interface BetssonMarket {
  name?: string;
  selections: BetssonSelection[];
}
export interface BetssonEvent {
  idfoevent?: string;
  // "MATCH" or "OUTRIGHT"; the entry closing a page has neither.
  idfoeventtype?: string;
  name?: string;
  tsstart?: string;
  tournamentname?: string;
  participantname_home?: string;
  participantname_away?: string;
  markets?: BetssonMarket[];
}
interface BetssonNode {
  name?: string;
  focontentid?: string;
  idfwbonavigationtypes?: string[];
}
interface BetssonReply {
  errorType?: string;
  data?: unknown;
}

// The decimal price the site shows for a fractional one: 61/20 is 4.05. Two
// decimals, as it writes them, which also keeps floating-point dust out
// (57/100 + 1 is 1.5699999999999998).
export function fractionalToDecimal(up: string | null | undefined, down: string | null | undefined): number {
  if (typeof up !== "string" || typeof down !== "string" || up.trim() === "" || down.trim() === "") return NaN;
  const numerator = Number(up);
  const denominator = Number(down);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return NaN;
  return Math.round((numerator / denominator + 1) * 100) / 100;
}

// A match as a raw event: its two sides, its start, its result market's prices
// labelled with the teams' names and "Match nul" (the matcher reads them as 1,
// X and 2, src/matcher/match.ts). The teams are named as the market's
// selections name them ("CFR Cluj"), not as the match's title does ("FC CFR
// 1907 Cluj vs ..."). A match without a result market (a Total or a Handicap
// only, a match already started, which has no markets left) is not one to
// compare.
function matchToRawEvent(event: BetssonEvent, sport: string): RawEvent | null {
  const home = event.participantname_home?.trim();
  const away = event.participantname_away?.trim();
  const market = event.markets?.find((m) => isResultMarketTitle(m.name ?? ""));
  if (!home || !away || !event.tsstart || !market) return null;
  if (market.selections.length !== 2 && market.selections.length !== 3) return null;
  const marketName = canonicalMarketName(market.selections.length);
  return {
    sport,
    // Betsson ends it with a line break.
    competition: event.tournamentname?.trim() ?? "",
    startTime: event.tsstart,
    participants: [home, away],
    odds: market.selections.map(
      (s): RawOdds => ({
        market: marketName,
        selection: s.name?.trim() ?? "",
        price: fractionalToDecimal(s.currentpriceup, s.currentpricedown),
      })
    ),
    sourceId: event.idfoevent,
  };
}

// The market of an outright that is its winner's, in French or in English:
// "Course - Vainqueur", "Singapore Grand Prix Sprint Race - Winner", "Championnat
// des pilotes - Vainqueur" (8/10/2026). Not "Course - Constructeur Vainqueur" (the
// teams'), a margin, a top 3, nor a duel: those are other bets.
const WINNER_MARKET = /(?:^|\s-\s)(?:winner|vainqueur)\s*$/i;

// An outright (a Grand Prix session, a season's title) as a winner market: its
// title and its runners. A runner Betsson does not price (the drivers' title
// lists 22, 6 of them priced) has no price here, which validateRawEvent drops.
// The sports without head-to-heads (OUTRIGHT_SPORTS) are read, and the winner of
// a competition in the others (COMPETITION_WINNER_SPORTS, "National Provincial
// Championship 2026 - Winner").
function outrightToRawEvent(event: BetssonEvent, sport: string): RawEvent | null {
  const title = event.name?.trim();
  const market = event.markets?.find((m) => WINNER_MARKET.test(m.name ?? ""));
  if (!hasOutrights(sport) || !title || !event.tsstart || !market) return null;
  return {
    sport,
    competition: event.tournamentname?.trim() ?? "",
    startTime: event.tsstart,
    participants: [title],
    odds: market.selections.map(
      (s): RawOdds => ({
        market: MARKET_OUTRIGHT,
        selection: s.name?.trim() ?? "",
        price: fractionalToDecimal(s.currentpriceup, s.currentpricedown),
      })
    ),
    sourceId: event.idfoevent,
  };
}

// A sport's list as raw events. The sport is the one the menu names (which is
// how it is asked for): the events' own name for it differs now and then
// ("American Football" for "Foot US", "MotoGp" for "Moto"). The entries that
// close a page are not events.
export function parseBetssonEvents(list: readonly BetssonEvent[], sportName: string): RawEvent[] {
  const sport = canonicalSport("betsson", sportName);
  const events: RawEvent[] = [];
  for (const event of list) {
    if (!event || typeof event !== "object") continue;
    try {
      const raw =
        event.idfoeventtype === "MATCH"
          ? matchToRawEvent(event, sport)
          : event.idfoeventtype === "OUTRIGHT"
            ? outrightToRawEvent(event, sport)
            : null;
      const checked = raw && validateRawEvent(raw, "betsson");
      if (checked) events.push(checked);
    } catch (err) {
      // One malformed event must not take down the rest of the page.
      console.warn(`[scraper:betsson] failed to read event ${event.idfoevent}, skipping it:`, err);
    }
  }
  return events;
}

export async function post(type: string, id: string): Promise<BetssonReply> {
  const res = await fetch(SERVICE_URL, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ clientContext: { language: "FR", ipAddress: "0.0.0.0" }, contentId: { type, id } }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Betsson ${type} ${id}: HTTP ${res.status}`);
  return (await res.json()) as BetssonReply;
}

interface BetssonSport {
  name: string;
  code: string;
}

// The menu's sports this project reads, by the names ./canonical.ts lists.
function readSports(menu: BetssonReply): BetssonSport[] {
  const nodes = (menu.data as { bonavigationnodes?: BetssonNode[] } | undefined)?.bonavigationnodes ?? [];
  const wanted = new Set(verifiedSportNames("betsson").map((name) => name.toLowerCase()));
  return nodes.flatMap((node) => {
    const isSport = node.idfwbonavigationtypes?.includes("SPORT");
    return isSport && node.name && node.focontentid && wanted.has(node.name.toLowerCase())
      ? [{ name: node.name, code: node.focontentid }]
      : [];
  });
}

// "20261008" for today and the day 90 days on, as the site words its range.
function dateRange(now: Date): string {
  const day = (date: Date) => date.toISOString().slice(0, 10).replace(/-/g, "");
  return `${day(now)}0000/${day(new Date(now.getTime() + DAYS_AHEAD * 86_400_000))}2359`;
}

// A page of a sport's list. Where a list has nothing (a sport out of season, a
// page past the last) the service answers 200 and CONTENT_NOT_FOUND: an empty
// page, not a failure.
function readList(reply: BetssonReply): BetssonEvent[] {
  if (reply.errorType === "CONTENT_NOT_FOUND") return [];
  if (reply.errorType || !Array.isArray(reply.data)) {
    throw new Error(`Betsson answered ${reply.errorType ?? "no list"}`);
  }
  return reply.data;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchSport(sport: BetssonSport, range: string): Promise<RawEvent[]> {
  const events: RawEvent[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    let list: BetssonEvent[];
    try {
      list = readList(await post("eventListBySportTypeDate", `${sport.code}/${range}/${page}/${PAGE_SIZE}/D`));
    } catch (err) {
      // Keep what earlier pages gave us rather than throwing everything away.
      if (page === 0) throw err;
      console.warn(`[scraper:betsson] "${sport.name}" page ${page} failed, keeping ${events.length} events:`, err);
      break;
    }
    if (!list.some((event) => event?.idfoeventtype)) break;
    events.push(...parseBetssonEvents(list, sport.name));
    await sleep(PAGE_DELAY_MS);
  }
  return events;
}

export async function fetchBetsson(): Promise<RawEvent[]> {
  const sports = readSports(await post("boNavigationList", MENU_ID));
  if (sports.length === 0) throw new Error("Betsson's menu lists none of the sports it is read for");

  const range = dateRange(new Date());
  const read = await pool(sports, CONCURRENCY, (sport) => fetchSport(sport, range));
  // Every sport failing is the bookmaker failing (runScrapeCycle retries it);
  // one failing costs only its own matches.
  if (read.every((r) => r.status === "rejected")) throw new Error("every betsson sport failed");
  return read.flatMap((r, i) => {
    if (r.status === "fulfilled") return r.value;
    console.warn(`[scraper:betsson] "${sports[i].name}" failed, skipping it:`, r.reason);
    return [];
  });
}

export const betssonScraper: BookmakerScraper = { id: "betsson", fetch: fetchBetsson };
