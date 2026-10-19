import { RawEvent, RawOdds } from "../types";
import { BookmakerScraper } from "./run";
import { canonicalMarketName, canonicalSport } from "./canonical";
import { netOfStakeTax } from "./stakeTax";
import { teamName } from "./twentybet";
import { validateRawEvent } from "./validateRawEvent";

// ODDSET's prices (the Lotto companies' sports betting, on Entain's platform,
// bwin's), from the API its site reads them from (www.oddset.de/cds-api, seen
// in its pages' requests, 19/10/2026, tests/scraper/fixtures/oddset-*.json):
// JSON GETs, without an account or a cookie, with the site's access id and
// the headers its own pages send (the page's address, the device), without
// which the API answers a 403 page. No challenge stands in front of it.
//
// A sport's matches before kick-off with their main market, 500 an answer.

const API = "https://www.oddset.de/cds-api/bettingoffer/fixtures";
// The site's access id, which every request of its pages carries.
const ACCESS_ID = "ZjE1ZjlmZDMtYTZlZC00OTQyLTlkYjgtNDZlOWMzZTMyZTI5";
const SITE = "https://www.oddset.de/de/sports";

// The German betting tax, 5.3%. Taken off the whole price, as for
// bet-at-home.de (./betathome.ts): a price never shows more than it pays.
export const ODDSET_TAX = 0.053;

const PAGE_SIZE = 500;
// A sport's matches read at most: 4 answers.
const MAX_FIXTURES = 2000;
const REQUEST_DELAY_MS = 300;
// A stalled request must fail rather than hang: the worker's overlap guard
// would otherwise skip every later cycle, for every bookmaker.
const REQUEST_TIMEOUT_MS = 30_000;

// The sports read, by the API's sport id: its main market's name and outcomes
// (a 1, X and 2 is the result in ordinary time, the project's 1X2; a 1 and 2
// the winner, overtime included), and whether the API's main markets alone
// ("MainMarkets", a third of the size) carry it, which they don't for the
// American football's, the handball's and the volleyball's. Verified on the
// matches of 19/10/2026.
export const ODDSET_SPORTS: Readonly<Record<string, { market: string; outcomes: 2 | 3; mainOnly: boolean }>> = {
  "4": { market: "Match Result", outcomes: 3, mainOnly: true },
  "5": { market: "Match Winner", outcomes: 2, mainOnly: true },
  "7": { market: "Money Line", outcomes: 2, mainOnly: true },
  "12": { market: "3-Way - Result After Regular Time", outcomes: 3, mainOnly: true },
  "11": { market: "Moneyline", outcomes: 2, mainOnly: false },
  "16": { market: "Match Result", outcomes: 3, mainOnly: false },
  "18": { market: "Match Result", outcomes: 2, mainOnly: false },
};

// What an answer gives of a match, the rest left out. A match's markets come
// in one of two forms: "optionMarkets" (an option names its team by the
// match's participant id) or "games" (a result names its side "1", "X" or
// "2", 1 the team named first).
export interface OddsetFixture {
  id?: string;
  name?: { value?: string };
  startDate?: string;
  stage?: string;
  isOpenForBetting?: boolean;
  competition?: { name?: { value?: string } };
  participants?: { id?: number; name?: { value?: string }; properties?: { type?: string } }[];
  optionMarkets?: {
    name?: { value?: string };
    status?: string;
    options?: { name?: { value?: string }; status?: string; price?: { odds?: number }; parameters?: { fixtureParticipant?: number } }[];
  }[];
  games?: {
    name?: { value?: string };
    visibility?: string;
    results?: { name?: { value?: string }; sourceName?: { value?: string }; odds?: number; visibility?: string }[];
  }[];
}
export interface OddsetReply {
  fixtures?: OddsetFixture[];
  totalCount?: number;
}

export const oddsetUrl = (sportId: string, skip: number): string =>
  `${API}?${new URLSearchParams({
    "x-bwin-accessid": ACCESS_ID,
    lang: "en",
    country: "DE",
    userCountry: "DE",
    fixtureTypes: "Standard",
    state: "Latest",
    offerMapping: ODDSET_SPORTS[sportId].mainOnly ? "MainMarkets" : "Filtered",
    offerCategories: "Gridable",
    fixtureCategories: "Gridable,NonGridable,Other",
    sportIds: sportId,
    isPriceBoost: "false",
    statisticsModes: "None",
    skip: String(skip),
    take: String(PAGE_SIZE),
    sortBy: "StartDate",
  })}`;

// A participant's name as the other bookmakers write it: without the country
// a club or a player is given ("Bandari FC (KEN)", "Andrea Guerrieri (ITA)"),
// a women's team with "(W)".
const nameOf = (raw: string): string =>
  raw
    .replace(/\s*\(Women\)$/i, " (W)")
    .replace(/\s*\([A-Z]{3}\)$/, "")
    .trim();

// The matches of a sport's answer as raw events: each match not yet started
// with its main market, labelled with the teams' names and "Draw" (the matcher
// reads them as 1, X and 2), the prices net of the tax. A market without one
// visible price per outcome leaves the match out.
export function parseOddsetFixtures(reply: OddsetReply, sportId: string): RawEvent[] {
  const config = ODDSET_SPORTS[sportId];
  if (!config) return [];
  const events: RawEvent[] = [];
  for (const fixture of reply.fixtures ?? []) {
    try {
      if (fixture.stage !== "PreMatch" || fixture.isOpenForBetting === false || !fixture.startDate) continue;
      const competition = (fixture.competition?.name?.value ?? "").trim();
      // The two teams, in the order the match's name gives them (its players
      // are participants too).
      const teams = (fixture.participants ?? []).filter((p) => p.properties?.type !== "Player");
      const typed = ["HomeTeam", "AwayTeam"].map((type) => teams.find((p) => p.properties?.type === type));
      const [first, second] = typed.every(Boolean) ? typed : teams;
      if (teams.length !== 2 || !first?.name?.value || !second?.name?.value) continue;
      const [firstName, secondName] = [first, second].map((p) => teamName(nameOf(p.name!.value!), competition));
      // An American match is "Away at Home": the home team comes first.
      const awayFirst = / at /.test(fixture.name?.value ?? "") && !typed.every(Boolean);
      const [home, away] = awayFirst ? [secondName, firstName] : [firstName, secondName];
      const sides: Record<string, string> = { "1": firstName, X: "Draw", "2": secondName };

      const prices = new Map<string, number>();
      const market = fixture.optionMarkets?.find((m) => m.name?.value === config.market && m.options?.length === config.outcomes);
      const game = fixture.games?.find((g) => g.name?.value === config.market && g.results?.length === config.outcomes);
      if (market) {
        if (market.status !== "Visible") continue;
        for (const option of market.options ?? []) {
          // Its team by the participant's id, else (a draw, an option without
          // one) by its name: the team's, or its nickname alone, as the NHL's
          // and the NBA's are ("Ducks" for "Anaheim Ducks").
          const participant = option.parameters?.fixtureParticipant;
          const name = option.name?.value ?? "";
          const isTeam = (team: string) => team === name || team.endsWith(` ${name}`);
          const selection =
            participant !== undefined
              ? participant === first.id
                ? firstName
                : participant === second.id
                  ? secondName
                  : undefined
              : isTeam(first.name.value) && !isTeam(second.name.value)
                ? firstName
                : isTeam(second.name.value) && !isTeam(first.name.value)
                  ? secondName
                  : /^(x|draw)$/i.test(name)
                    ? "Draw"
                    : undefined;
          if (!selection || prices.has(selection)) throw new Error(`unexpected option "${option.name?.value}"`);
          prices.set(selection, option.status === "Visible" && typeof option.price?.odds === "number" ? option.price.odds : NaN);
        }
      } else if (game) {
        if (game.visibility !== "Visible") continue;
        for (const result of game.results ?? []) {
          const selection = sides[result.sourceName?.value ?? ""];
          if (!selection || prices.has(selection)) throw new Error(`unexpected result "${result.sourceName?.value}"`);
          prices.set(selection, result.visibility === "Visible" && typeof result.odds === "number" ? result.odds : NaN);
        }
      } else continue;
      if (prices.has("Draw") !== (config.outcomes === 3)) throw new Error("unexpected draw");

      const marketName = canonicalMarketName(config.outcomes);
      const odds: RawOdds[] = [...prices].map(([selection, price]) => ({
        market: marketName,
        selection,
        price: netOfStakeTax(price, ODDSET_TAX),
      }));
      const raw: RawEvent = {
        sport: canonicalSport("oddset", sportId),
        competition,
        startTime: new Date(fixture.startDate).toISOString(),
        participants: [home, away],
        odds,
        sourceId: String(fixture.id),
      };
      const checked = validateRawEvent(raw, "oddset");
      if (checked) events.push(checked);
    } catch (err) {
      // One malformed match must not take down the rest of the list.
      console.warn(`[scraper:oddset] failed to read match ${fixture?.id}, skipping it:`, err);
    }
  }
  return events;
}

const HEADERS = {
  accept: "application/json",
  "accept-language": "de-DE",
  referer: SITE,
  "x-bwin-browser-url": SITE,
  "x-device-type": "desktop_Linux",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchPage(sportId: string, skip: number): Promise<OddsetReply> {
  const res = await fetch(oddsetUrl(sportId, skip), { headers: HEADERS, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`oddset sport ${sportId}: HTTP ${res.status}`);
  return (await res.json()) as OddsetReply;
}

// A sport's matches, an answer after the other until the API has given them all.
async function fetchSport(sportId: string, delayMs: number): Promise<RawEvent[]> {
  const events: RawEvent[] = [];
  for (let skip = 0; skip < MAX_FIXTURES; skip += PAGE_SIZE) {
    const reply = await fetchPage(sportId, skip);
    events.push(...parseOddsetFixtures(reply, sportId));
    await sleep(delayMs);
    if ((reply.fixtures?.length ?? 0) < PAGE_SIZE || skip + PAGE_SIZE >= (reply.totalCount ?? 0)) break;
  }
  return events;
}

export async function fetchOddset(opts: { delayMs?: number } = {}): Promise<RawEvent[]> {
  const sports = Object.keys(ODDSET_SPORTS);
  const read = [];
  // One sport after the other.
  for (const sportId of sports) {
    read.push(await fetchSport(sportId, opts.delayMs ?? REQUEST_DELAY_MS).then((value) => ({ ok: true as const, value }), (reason) => ({ ok: false as const, reason })));
  }
  // Every sport failing is the bookmaker failing (runScrapeCycle retries it);
  // one failing costs only its own matches.
  if (read.every((r) => !r.ok)) throw new Error("every oddset sport failed");
  const seen = new Set<string>();
  return read.flatMap((r, i) => {
    if (!r.ok) {
      console.warn(`[scraper:oddset] sport ${sports[i]} failed, skipping it:`, r.reason);
      return [];
    }
    // A match moving between two answers while they are read comes in both.
    return r.value.filter((e) => !seen.has(e.sourceId ?? "") && seen.add(e.sourceId ?? ""));
  });
}

export const oddsetScraper: BookmakerScraper = { id: "oddset", fetch: fetchOddset };
