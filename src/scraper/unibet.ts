import { RawEvent, RawOdds } from "../types";
import { BookmakerScraper } from "./run";
import { canonicalMarketName, canonicalSport, hasOutrights, MARKET_OUTRIGHT, OUTRIGHT_SPORTS } from "./canonical";
import { validateRawEvent } from "./validateRawEvent";

export const BASE_URL = "https://www.unibet.fr/lvs-api";

// Unibet's internal sport/category ids, as the site's own "all sports" page
// sends them (p4011, Nascar's, is the one its /paris-nascar page asks for). The
// upcoming-matches route takes them as one comma-separated path segment.
const SPORT_IDS =
  "p240,p239,p227,p22877,p1100,p1200,p1300,p2700,p4300,p2200,p237,p22884,p238,p900,p1800,p1900,p22878,p2100,p226,p1,p8000,p6012,p6013,p5000,p1201,p4011";

// The route only accepts a page size of 50 (200 and 500 answer 404); the site
// paginates with pageIndex until a page comes back empty (~25 pages today).
const PAGE_SIZE = 50;
const MAX_PAGES = 40;
const PAGE_DELAY_MS = 500;
// A stalled request must fail rather than hang: the worker's overlap guard
// would otherwise skip every later cycle, for every bookmaker.
export const REQUEST_TIMEOUT_MS = 15_000;

// "connection: close": reusing a keep-alive socket made every other page take
// ~13 s against unibet.fr; a fresh connection per request answers in ~100 ms.
export const HEADERS = {
  connection: "close",
  accept: "application/json, text/plain, */*",
  "user-agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
};

// `items` is a flat map where each entry points at its parent through `parent`
// and the id's first letter gives its kind: o = outcome (odd), m = market,
// e = event (match), p = league/category.
export interface UnibetItem {
  parent?: string;
  desc?: string;
  price?: string | null;
  start?: string;
  pdesc?: string;
  a?: string | null;
  b?: string | null;
  // "G" is a head-to-head game; "R" is a race/outright (a and b are null).
  eType?: string;
  // An outcome that cannot be bet on: "hidden", "unpriced".
  flags?: string[];
  pos?: number;
  path?: { Sport?: string };
  // A market's type and period (100 the match, 102 and 103 its halves, 113 to
  // 115 a tennis match and its sets), which its title does not tell.
  markettypeId?: number;
  periodId?: number;
  // The period's name ("Match", "Temps réglementaire", "1ère Mi-temps"): the
  // same market type is for one or another from a competition to another.
  period?: string;
  // An outcome's line ("Plus 2.5" is 2.5).
  spread?: number | null;
}

export interface UnibetPage {
  items?: Record<string, UnibetItem>;
}

// Unibet writes the start as UTC "YYMMDDHHmm" (e.g. "2610060015" for
// 2026-10-06 00:15Z -- verified against the NFL Monday-night kickoff, 20:15 in
// New York).
export function parseUnibetStart(raw: string): string {
  const m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(raw);
  if (!m) throw new Error(`unexpected Unibet start "${raw}"`);
  const [, yy, mo, dd, hh, mi] = m;
  return new Date(`20${yy}-${mo}-${dd}T${hh}:${mi}:00.000Z`).toISOString();
}

// Prices come as French decimal strings ("1,53"). A suspended outcome has a
// null price: NaN here, and validateRawEvent drops that entry (not the event).
export function parsePrice(raw: string | null | undefined): number {
  return typeof raw === "string" ? Number(raw.replace(",", ".")) : NaN;
}

export function kind(id: string): string {
  return id.charAt(0);
}

// The market of an outright that is its winner's: "Vainqueur" (a golf
// tournament, a race, a season), a Grand Prix session's ("Vainqueur (Q)",
// "(S)", "(SQ)": the qualifying, the sprint, its shootout) and the Formula 2's
// "Pilote vainqueur" (real feed, 7/10/2026). "Vainqueur sans Johannes Klaebo"
// (the field without its favourite) is another bet, and so is a head-to-head
// ("Face à Face (...)").
const WINNER_MARKET = /^(?:pilote )?vainqueur(?: \((?:SQ|S|Q)\))?$/i;

// The same for a competition of a sport with head-to-heads, the winner of which
// is also "Vainqueur" ("Ligue 1 26/27", "NBA 26/27") or, for a few, headed by the
// competition ("UEFA Women's Champions League - Vainqueur"). Not a half of a season
// ("Clausura 2026 - Vainqueur"), nor "Vainqueur sans FC Seoul" (14/10/2026).
const COMPETITION_WINNER_MARKET = /^(?:.+ - )?vainqueur$/i;
const PART_OF_A_COMPETITION = /\b(clausura|apertura|phase|groupe|group|stage|round|tour|qualif)/i;

function isWinnerMarket(sport: string, desc: string): boolean {
  if (OUTRIGHT_SPORTS.has(sport)) return WINNER_MARKET.test(desc);
  return COMPETITION_WINNER_MARKET.test(desc) && !PART_OF_A_COMPETITION.test(desc);
}

// What Unibet calls a session or a season when its title is only that: the
// Grand Prix or the series is the competition ("GP SIngapour" / "Course",
// "Nascar Cup Series 2026" / "Saison 2026").
const GENERIC_TITLE = /^(?:course|sprint|sprint qualif|qualification|saison \d{4})$/i;

// "X.Schauffele", "SJ.Im", "M-W.Lee": the initials run into the surname, which
// the matcher then does not take for initials ("X. Schauffele" it does, like
// Winamax's and Betclic's names). A surname first ("Bridgeman, Jacob") is left.
const INITIALS_RUN_INTO_SURNAME = /^([A-Za-z]{1,2}(?:-[A-Za-z])?)\.(?=\S)/;

export const spaceInitials = (name: string): string => name.replace(INITIALS_RUN_INTO_SURNAME, "$1. ");

// The name of a period in regular time, and of a two-way market in it.
const REGULAR_TIME = "Temps réglementaire";
const REGULAR_TIME_TWO_WAY = "Face à Face (temps réglementaire)";

// An outright (a golf tournament, a race, a season) as a winner market: its
// title and its runners. An outcome Unibet hides ("hidden") or does not price
// ("unpriced", no price) is not a bet one can place: the Masters lists 180
// runners, 55 of them available.
function readOutright(
  eventId: string,
  event: UnibetItem,
  markets: Array<{ id: string; item: UnibetItem }>,
  outcomesByMarket: Map<string, UnibetItem[]>
): RawEvent | null {
  const sport = canonicalSport("unibet", event.path?.Sport ?? "");
  const title = event.desc?.trim();
  const winner = markets.find(({ item }) => isWinnerMarket(sport, item.desc?.trim() ?? ""));
  if (!hasOutrights(sport) || !title || !event.start || !winner) return null;
  const competition = (event.pdesc ?? "").trim();
  const odds = (outcomesByMarket.get(winner.id) ?? [])
    .filter((o) => o.desc && !o.flags?.length && o.price)
    .sort((x, y) => (x.pos ?? 0) - (y.pos ?? 0))
    .map((o): RawOdds => ({ market: MARKET_OUTRIGHT, selection: spaceInitials(o.desc!.trim()), price: parsePrice(o.price) }));
  return validateRawEvent(
    {
      sport,
      competition,
      startTime: parseUnibetStart(event.start),
      participants: [GENERIC_TITLE.test(title) && competition ? `${competition} - ${title}` : title],
      odds,
      // Its markets are asked for by it (./unibetMarkets.ts).
      sourceId: eventId,
    },
    "unibet"
  );
}

export function parseUnibetPage(page: UnibetPage): RawEvent[] {
  const items = page.items ?? {};

  const outcomesByMarket = new Map<string, UnibetItem[]>();
  const marketsByEvent = new Map<string, Array<{ id: string; item: UnibetItem }>>();
  for (const [id, item] of Object.entries(items)) {
    if (!item.parent) continue;
    if (kind(id) === "o") {
      const list = outcomesByMarket.get(item.parent) ?? [];
      list.push(item);
      outcomesByMarket.set(item.parent, list);
    } else if (kind(id) === "m") {
      const list = marketsByEvent.get(item.parent) ?? [];
      list.push({ id, item });
      marketsByEvent.set(item.parent, list);
    }
  }

  const events: RawEvent[] = [];
  for (const [eventId, event] of Object.entries(items)) {
    if (kind(eventId) !== "e") continue;
    try {
      if (event.eType === "R") {
        // An outright carries no two participants: only those of the sports
        // without head-to-heads are read (OUTRIGHT_SPORTS).
        const outright = readOutright(eventId, event, marketsByEvent.get(eventId) ?? [], outcomesByMarket);
        if (outright) events.push(outright);
        continue;
      }
      if (event.eType !== "G" || !event.a || !event.b || !event.start) continue;

      // Page results list the event's main market only; if several ever show
      // up, the site's own ordering (pos) puts the main one first.
      const markets = (marketsByEvent.get(eventId) ?? []).sort((x, y) => (x.item.pos ?? 0) - (y.item.pos ?? 0));
      const main = markets.find(({ id }) => {
        const n = outcomesByMarket.get(id)?.length ?? 0;
        return n === 2 || n === 3;
      });
      if (!main) continue;

      const outcomes = (outcomesByMarket.get(main.id) ?? []).sort((x, y) => (x.pos ?? 0) - (y.pos ?? 0));
      // The shared cross-bookmaker market key comes from the outcome count,
      // not Unibet's own market title. See ./canonical.ts.
      const sport = canonicalSport("unibet", event.path?.Sport ?? "");
      // Except a basketball match's two-way market in regular time (a "Face à
      // Face" of the leagues with no 1 N 2, a draw then refunding or losing):
      // it is no winner, overtime included, as the others' are, and compared
      // with nothing. Unibet's winner is in the match's markets (./unibetMarkets.ts).
      const marketName =
        sport === "basketball" && outcomes.length === 2 && main.item.period === REGULAR_TIME
          ? REGULAR_TIME_TWO_WAY
          : canonicalMarketName(outcomes.length);
      const odds = outcomes
        .map((o): RawOdds => ({ market: marketName, selection: o.desc ?? "", price: parsePrice(o.price) }))
        .filter((o) => o.selection !== "");

      const candidate: RawEvent = {
        sport,
        competition: event.pdesc ?? "",
        startTime: parseUnibetStart(event.start),
        participants: [event.a, event.b],
        odds,
        // Its markets are asked for by it (./unibetMarkets.ts).
        sourceId: eventId,
      };
      const validated = validateRawEvent(candidate, "unibet");
      if (validated) events.push(validated);
    } catch (err) {
      // One malformed event must not take down the rest of the page.
      console.warn(`[scraper:unibet] failed to parse event ${eventId}, skipping it:`, err);
    }
  }
  return events;
}

// Anonymous token the /lvs-api routes require in X-LVS-HSToken (they answer
// 401 "Missing X-LVS-HSToken" without it).
export async function fetchToken(): Promise<string> {
  const res = await fetch(`${BASE_URL}/acc/token`, { headers: HEADERS, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Unibet token request failed: ${res.status}`);
  const body = (await res.json()) as { hsToken?: string };
  if (!body.hsToken) throw new Error("Unibet token response had no hsToken");
  return body.hsToken;
}

async function fetchPage(token: string, pageIndex: number): Promise<Response> {
  const url =
    `${BASE_URL}/next/${PAGE_SIZE}/${SPORT_IDS}` +
    `?lineId=1&originId=3&breakdownEventsIntoDays=true&showPromotions=true&pageIndex=${pageIndex}`;
  return fetch(url, { headers: { ...HEADERS, "x-lvs-hstoken": token }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchAllUnibetPages(): Promise<RawEvent[]> {
  let token = await fetchToken();
  const events: RawEvent[] = [];

  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
    let res = await fetchPage(token, pageIndex);
    if (res.status === 401) {
      // The token expired mid-scrape: get a new one and retry this page once.
      token = await fetchToken();
      res = await fetchPage(token, pageIndex);
    }
    if (!res.ok) {
      // Anti-bot (403) or a server error. Keep what earlier pages gave us
      // rather than throwing everything away; runScrapeCycle retries the whole
      // fetch() once when nothing at all could be read.
      if (pageIndex === 0) throw new Error(`Unibet page 0 failed: ${res.status}`);
      console.warn(`[scraper:unibet] page ${pageIndex} failed: ${res.status}, stopping with ${events.length} events`);
      break;
    }

    const page = (await res.json()) as UnibetPage;
    const hasEvents = Object.keys(page.items ?? {}).some((id) => kind(id) === "e");
    if (!hasEvents) break;
    events.push(...parseUnibetPage(page));
    await sleep(PAGE_DELAY_MS);
  }
  return events;
}

export const unibetScraper: BookmakerScraper = {
  id: "unibet",
  fetch: fetchAllUnibetPages,
};
