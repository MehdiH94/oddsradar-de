import { RawEvent, RawOdds } from "../types";
import { BookmakerScraper } from "./run";
import { canonicalMarketName, canonicalSport } from "./canonical";
import { netOfStakeTax } from "./stakeTax";
import { validateRawEvent } from "./validateRawEvent";

// Merkur Bets's prices (merkurbets.de, whose sportsbook also answers for the
// old xtip.de and cashpoint.de), from the odds service its site reads them from
// (oddsservice-msw-mb-de.cashpoint.solutions/odds/getGames, seen in its pages'
// requests from a German IP, 15/10/2026, tests/scraper/fixtures/merkurbets-*.json):
// JSON POSTs, without an account, a cookie or a token, with the site's headers.
//
// A sport's games not yet started (game type 4), asked with its main market
// only (the full answer is every market of every game: 39 MB for 1000 football
// matches, 70 KB with the main one): its result (1X2) or its winner.

const API = "https://oddsservice-msw-mb-de.cashpoint.solutions/odds/getGames/12";

// The German betting tax the site takes off the stake: its own settings say
// so ("stakeTaxEnabled": true, "stakeTax": 5, "winTaxEnabled": false, in
// v3-msw-mb-de.cashpoint.solutions/environment/client-environment.json,
// 15/10/2026). The prices are stored net of it (./stakeTax.ts).
export const MERKURBETS_TAX_ON_STAKE = 0.05;

// The games before kick-off ("1" are the live ones).
const PRE_MATCH = 4;
// The site's German jurisdiction, in every request's body.
const JURISDICTION_ID = 386;
// Games a request; the site pages its own lists the same way.
const PAGE_SIZE = 500;
const REQUEST_DELAY_MS = 300;
// A stalled request must fail rather than hang: the worker's overlap guard
// would otherwise skip every later cycle, for every bookmaker.
const REQUEST_TIMEOUT_MS = 20_000;

// The sports read, by the site's sport id: their English name (which leads
// some competitions' names, "Tennis - WTA Wuhan"), the ids of their main
// market (basketball has two, by league) and its number of outcomes. A main
// market of 1, X and 2 is the result in regular time (football, ice hockey,
// handball, rugby: the project's 1X2), one of 1 and 2 the winner, overtime
// included. Only those verified on the site's answers (15/10/2026): every
// game of these sports has one, but 13 football games of 1057 (no result
// market, specials).
export const MERKURBETS_SPORTS: Readonly<Record<string, { name: string; markets: number[]; outcomes: 2 | 3 }>> = {
  "1": { name: "Football", markets: [22242], outcomes: 3 },
  "2": { name: "Tennis", markets: [24692], outcomes: 2 },
  "10": { name: "Ice Hockey", markets: [53452], outcomes: 3 },
  "12": { name: "Basketball", markets: [21702, 21672], outcomes: 2 },
  "15": { name: "Handball", markets: [49122], outcomes: 3 },
  "6": { name: "American Football", markets: [30532], outcomes: 2 },
  "18": { name: "Rugby", markets: [27232], outcomes: 3 },
  "23": { name: "Volleyball", markets: [33882], outcomes: 2 },
  "11": { name: "Baseball", markets: [2932], outcomes: 2 },
};

const HEADERS = {
  accept: "application/json, text/plain, */*",
  "content-type": "application/json",
  "accept-language": "de-DE",
  origin: "https://v3-msw-mb-de.cashpoint.solutions",
  referer: "https://v3-msw-mb-de.cashpoint.solutions/",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
  // The site's: system, language (2: English, the dashboard's and the
  // exchange's, which eases the matching), the visitor's place (82: Germany).
  "x-system-id": "1",
  "x-language": "2",
  "x-location": "82",
  "x-client-country": "82",
};

export interface MerkurTip {
  // "1", "X" (" X" in handball's) or "2".
  text?: string;
  // The price in hundredths: 316 is 3.16.
  odds?: number | null;
}
export interface MerkurMarket {
  id?: number;
  isPrimary?: boolean;
  tips?: MerkurTip[];
}
export interface MerkurGame {
  id?: number;
  // 4 before kick-off, 1 live.
  type?: number;
  sport?: number;
  startTime?: string;
  teams?: { order?: number; name?: string }[];
  leagueInfo?: { name?: string };
  markets?: MerkurMarket[];
}
export interface MerkurGamesReply {
  games?: MerkurGame[] | null;
}

// The decimal price the site shows for the hundredths the API gives.
export const merkurOddsToDecimal = (odds: number | null | undefined): number =>
  typeof odds === "number" && Number.isFinite(odds) && odds > 0 ? Math.round(odds) / 100 : NaN;

// The project's sport of a game. The site's rugby is both codes: its league
// names say which ("Rugby Union European Champions Cup", "Rugby League ...").
function sportOf(sportId: string, competition: string): string {
  if (sportId === "18" && /\brugby league\b/i.test(competition)) return "rugby à xiii";
  return canonicalSport("merkurbets", sportId);
}

// The competition's name without the sport's that leads some ("Tennis - WTA
// Wuhan" is "WTA Wuhan"; "Deutschland 2. Bundesliga" stays as it is).
function competitionOf(name: string | undefined, sportName: string): string {
  const full = name?.trim() ?? "";
  const prefix = `${sportName} - `;
  return full.toLowerCase().startsWith(prefix.toLowerCase()) ? full.slice(prefix.length).trim() : full;
}

// The games of a sport's answer as raw events: each game not yet started with
// its main market, labelled with the teams' names and "Draw" (the matcher
// reads them as 1, X and 2), the prices net of the tax. A main market with
// another number of outcomes than its sport's leaves the game out.
export function parseMerkurGames(reply: MerkurGamesReply, sportId: string): RawEvent[] {
  const config = MERKURBETS_SPORTS[sportId];
  if (!config) return [];
  const events: RawEvent[] = [];
  for (const game of reply.games ?? []) {
    try {
      if (game.type !== PRE_MATCH || String(game.sport) !== sportId || !game.startTime) continue;
      const teams = [...(game.teams ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const home = teams[0]?.name?.trim();
      const away = teams[1]?.name?.trim();
      if (teams.length !== 2 || !home || !away) continue;
      const market = game.markets?.find((m) => m.isPrimary && config.markets.includes(m.id ?? -1));
      const tips = market?.tips ?? [];
      if (tips.length !== config.outcomes) continue;
      const names: Record<string, string> = { "1": home, X: "Draw", "2": away };
      const marketName = canonicalMarketName(tips.length);
      const odds: RawOdds[] = tips.map((tip) => {
        const selection = names[(tip.text ?? "").trim().toUpperCase()];
        if (!selection || (selection === "Draw" && config.outcomes === 2)) throw new Error(`unexpected outcome "${tip.text}"`);
        return { market: marketName, selection, price: netOfStakeTax(merkurOddsToDecimal(tip.odds), MERKURBETS_TAX_ON_STAKE) };
      });
      const competition = competitionOf(game.leagueInfo?.name, config.name);
      const raw: RawEvent = {
        sport: sportOf(sportId, competition),
        competition,
        startTime: game.startTime,
        participants: [home, away],
        odds,
        sourceId: String(game.id),
      };
      const checked = validateRawEvent(raw, "merkurbets");
      if (checked) events.push(checked);
    } catch (err) {
      // One malformed game must not take down the rest of the list.
      console.warn(`[scraper:merkurbets] failed to read game ${game?.id}, skipping it:`, err);
    }
  }
  return events;
}

async function getGames(body: Record<string, unknown>): Promise<MerkurGamesReply> {
  const res = await fetch(API, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ gameTypes: [PRE_MATCH], jurisdictionId: JURISDICTION_ID, ...body }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Merkur Bets getGames: HTTP ${res.status}`);
  return (await res.json()) as MerkurGamesReply;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A sport's every game, page after page.
async function fetchSport(sportId: string): Promise<RawEvent[]> {
  const events: RawEvent[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const reply = await getGames({ sportIds: [Number(sportId)], marketIds: MERKURBETS_SPORTS[sportId].markets, limit: PAGE_SIZE, offset });
    await sleep(REQUEST_DELAY_MS);
    events.push(...parseMerkurGames(reply, sportId));
    if ((reply.games?.length ?? 0) < PAGE_SIZE) return events;
  }
}

export async function fetchMerkurBets(): Promise<RawEvent[]> {
  const sports = Object.keys(MERKURBETS_SPORTS);
  const read = [];
  // One sport after the other: a few requests a cycle.
  for (const sportId of sports) {
    read.push(await fetchSport(sportId).then((value) => ({ ok: true as const, value }), (reason) => ({ ok: false as const, reason })));
  }
  // Every sport failing is the bookmaker failing (runScrapeCycle retries it);
  // one failing costs only its own games.
  if (read.every((r) => !r.ok)) throw new Error("every merkurbets sport failed");
  return read.flatMap((r, i) => {
    if (r.ok) return r.value;
    console.warn(`[scraper:merkurbets] sport ${sports[i]} (${MERKURBETS_SPORTS[sports[i]].name}) failed, skipping it:`, r.reason);
    return [];
  });
}

export const merkurbetsScraper: BookmakerScraper = { id: "merkurbets", fetch: fetchMerkurBets };
