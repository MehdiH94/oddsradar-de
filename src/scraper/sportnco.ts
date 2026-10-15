import { RawEvent, RawOdds } from "../types";
import { BookmakerScraper } from "./run";
import { BookmakerId, canonicalMarketName, canonicalSport, MARKET_OUTRIGHT, verifiedSportNames } from "./canonical";
import { validateRawEvent } from "./validateRawEvent";
import { pool } from "./pool";

// NetBet's prices, from the API its site reads them from: SportNCo's
// platform (ws.netbet.fr/component/..., captured 5/10/2026,
// tests/scraper/fixtures/sportnco-*.json.gz, Genybet's pages included: the
// same platform). A sport's page lists its competitions; a competition's
// match list gives each match's markets. Plain JSON POSTs, without an
// account. Genybet is on the same platform (ws.genybet.fr) with NetBet's
// prices, and is read the same way, gently: its firewall rejected four
// requests at a time (403 "Request Rejected", then 429) after a few cycles on
// 5/10/2026. If it rejects the server again its scraper fails alone, and the
// other bookmakers' cycle goes on.

export interface SportncoSite {
  id: Extract<BookmakerId, "netbet" | "genybet">;
  api: string;
  referer: string;
}

export const NETBET: SportncoSite = { id: "netbet", api: "https://ws.netbet.fr", referer: "https://www.netbet.fr/" };
export const GENYBET: SportncoSite = { id: "genybet", api: "https://ws.genybet.fr", referer: "https://www.genybet.fr/" };

// What the sites' front sends with every request.
const CONTEXT = {
  clientIp: "10.10.1.30",
  version: "1.0.1",
  device: "web_vuejs_desktop",
  lang: "fr",
  timezone: "Europe/Paris",
  url_params: {},
};
const REQUEST_TIMEOUT_MS = 20_000;
// Competitions read at once: about a hundred per cycle, a few KB each.
// Two, gently: Genybet's firewall rejected four on the same platform
// (5/10/2026), and is read with the same limit.
const CONCURRENCY = 2;

export interface SportncoSelection {
  odds: number;
  label: string;
}
export interface SportncoMarket {
  main?: number;
  order?: number;
  selection_order_type?: string;
  bets?: { label: string; selections: SportncoSelection[] }[];
}
export interface SportncoEvent {
  id: number;
  label: string;
  sport?: { url?: string };
  // The section of the sport's page: "/sport-automobile/formule-1", "/sport-automobile/nascar".
  category?: { url?: string };
  competition?: { label?: string; display_mode?: string };
  ts_start: number;
  type?: string;
  state?: string;
  is_canceled?: boolean;
  actors?: { type: string; label: string }[];
  markets?: SportncoMarket[];
}
export interface SportncoMenuEntry {
  url?: string;
  identifier?: string;
  nb_events?: number;
  menu?: SportncoMenuEntry[];
}

// A component of a page's answer, wherever it sits: component/data answers
// { components: [...] }, component/datatree the whole page's tree.
export function componentData(reply: unknown, key: string): Record<string, unknown> | undefined {
  const stack: unknown[] = [reply];
  while (stack.length > 0) {
    const node = stack.pop();
    if (Array.isArray(node)) stack.push(...node);
    else if (node && typeof node === "object") {
      const component = node as { tree_compo_key?: string; data?: Record<string, unknown> };
      if (component.tree_compo_key === key && component.data) return component.data;
      stack.push(...Object.values(node));
    }
  }
  return undefined;
}

// A sport's competitions with matches to bet on, from its page's A-Z menu:
// country > competition, each with its page's url.
export function readCompetitions(reply: unknown, sportKey: string): string[] {
  const menu = (componentData(reply, "menu_az_sportcatcomp")?.menu ?? []) as SportncoMenuEntry[];
  const urls = new Set<string>();
  const walk = (entries: SportncoMenuEntry[]) => {
    for (const entry of entries) {
      if (entry.identifier === "competition" && entry.url?.startsWith(`${sportKey}/`) && (entry.nb_events ?? 0) > 0) {
        urls.add(entry.url);
      }
      walk(entry.menu ?? []);
    }
  };
  walk(menu);
  return [...urls];
}

// A match's result or winner: "Qui va gagner le match ?", with its terms
// ("(prolongations incluses)", "(temps réglementaire)"), a fight's "Qui va
// gagner le combat ?"; not a handicap ("Handicap (-0.5) - Qui va gagner le
// match ?") nor a half's or a set's, nor a winner refunded on a draw ("Qui
// va gagner le combat ? (remboursé si match nul)", NetBet's fights): its
// draw is no loss, as Winamax's and Betclic's main markets are read
// (./canonical.ts, isResultMarketTitle).
const isWinnerMarket = (m: SportncoMarket) => {
  const label = m.bets?.[0]?.label ?? "";
  return (
    (m.selection_order_type === "1x2" || m.selection_order_type === "moneyline") &&
    /^Qui va gagner le (match|combat) \?/.test(label) &&
    !/rembours/i.test(label)
  );
};

// The main one: the one the site puts first (main 1); ice hockey's result in
// regular time first, like Winamax's and the exchange's 1X2, its winner
// overtime and shoot-out included (main 1 there) when that is all there is.
function mainMarket(event: SportncoEvent, sport: string): SportncoMarket | undefined {
  const winners = (event.markets ?? []).filter(isWinnerMarket);
  if (sport === "hockey sur glace") {
    const regular = winners.find((m) => m.selection_order_type === "1x2");
    if (regular) return regular;
  }
  return winners.find((m) => m.main === 1) ?? winners.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];
}

// A competition's matches as raw events: two teams, a start, their main
// market's prices labelled with the teams' names and "Nul" (the matcher reads
// them as 1, X and 2, src/matcher/match.ts).
export function readSportncoEvents(reply: unknown, site: SportncoSite): RawEvent[] {
  const events = (componentData(reply, "prematch_event_list")?.events ?? []) as SportncoEvent[];
  return events.flatMap((event) => {
    try {
      const raw = eventToRawEvent(event, site);
      const checked = raw && validateRawEvent(raw, site.id);
      return checked ? [checked] : [];
    } catch (err) {
      console.warn(`[scraper:${site.id}] failed to read match ${event?.id}, skipping it:`, err);
      return [];
    }
  });
}

// The sport pages whose events are tournaments and races, not matches: golf's
// competitions have no match list ("prematch_event_list" is empty), the winners
// of their tournaments sit in the page's "final_winner" component (6/10/2026);
// the same goes for the pages of the automobile (the F1, the F2 and Nascar), the
// moto, the cycling, the alpine skiing and the biathlon (8/10/2026).
const TOURNAMENT_PAGES: readonly string[] = ["/golf", "/sport-automobile", "/moto", "/cyclisme", "/ski-alpin", "/biathlon"];

// The pages of the sports with head-to-heads whose "final_winner" component lists
// the winners of their main competitions (Ligue 1, Roland-Garros, the NBA...) as it
// does the golf tournaments': an event each, a "Vainqueur" bet (14/10/2026: football
// 20 events, tennis 8, basketball 20, rugby 20, American football 12, ice hockey 7,
// baseball 3). Beside each winner the page lists the other bets on the competition
// (its Top 4, its top scorer, its relegated, "Vainqueur (sans le PSG)", a
// conference's winner...), which validateRawEvent leaves out by their titles.
// These pages are read for their matches too, unlike TOURNAMENT_PAGES.
const COMPETITION_PAGES: readonly string[] = ["/football", "/tennis", "/basketball", "/hockey-glace", "/rugby", "/handball", "/foot-us", "/baseball", "/rugby-a-xiii", "/snooker"];

// The Formula 1 is a section of the automobile's page, not a page of its own:
// its events are told by their section's url, and VERIFIED_SPORTS names it so.
const FORMULA_1_SECTION = "/sport-automobile/formule-1";
const FORMULA_1_PAGE = "/formule-1";

// "Open d'Espagne - 2026 - Vainqueur" > "Open d'Espagne 2026", the way the
// other bookmakers write the tournament's title; "Grand Prix de Singapour -
// 2026 - Vainqueur du Sprint" > "Grand Prix de Singapour 2026 - Sprint", and a
// season "2026/2027" is a year too.
const tournamentTitle = (rawLabel: string): string => {
  // "NBA Cup 2026 – Conférence Ouest – Vainqueur": en dashes, for some.
  const label = rawLabel.replace(/\s+[–—]\s+/g, " - ");
  const winnerOf = /\s*-\s*Vainqueur(?:\s+du\s+(.+?))?\s*$/i.exec(label);
  const of = winnerOf?.[1] ? ` - ${winnerOf[1]}` : "";
  const named = winnerOf ? label.slice(0, winnerOf.index) : label;
  return `${named.replace(/\s*-\s*(\d{4}(?:\/\d{2,4})?)\s*$/, " $1").trim()}${of}`;
};

// A tournament's winners as raw events: its title as the only participant, one
// "Vainqueur" selection per player.
export function readSportncoTournaments(reply: unknown, site: SportncoSite): RawEvent[] {
  const events = (componentData(reply, "final_winner")?.events ?? []) as SportncoEvent[];
  return events.flatMap((event) => {
    try {
      const raw = tournamentToRawEvent(event, site);
      const checked = raw && validateRawEvent(raw, site.id);
      return checked ? [checked] : [];
    } catch (err) {
      console.warn(`[scraper:${site.id}] failed to read tournament ${event?.id}, skipping it:`, err);
      return [];
    }
  });
}

function tournamentToRawEvent(event: SportncoEvent, site: SportncoSite): RawEvent | null {
  if (event.type !== "pm" || event.state !== "pm" || event.is_canceled || !event.sport?.url) return null;
  const bet = event.markets?.[0]?.bets?.[0];
  const title = tournamentTitle(event.label ?? "");
  if (!title || bet?.label.trim() !== "Vainqueur") return null;
  const page = event.category?.url === FORMULA_1_SECTION ? FORMULA_1_PAGE : event.sport.url;
  return {
    sport: canonicalSport(site.id, page),
    competition: event.competition?.label?.trim() ?? "",
    startTime: new Date(event.ts_start * 1000).toISOString(),
    participants: [title],
    odds: bet.selections.map((s): RawOdds => ({ market: MARKET_OUTRIGHT, selection: s.label.trim(), price: s.odds })),
    sourceId: String(event.id),
  };
}

function eventToRawEvent(event: SportncoEvent, site: SportncoSite): RawEvent | null {
  // A match not started yet (pre-match, "pm"), between two sides ("vs": a
  // competition's winner is listed otherwise).
  if (event.type !== "pm" || event.state !== "pm" || event.is_canceled) return null;
  if (event.competition?.display_mode !== "vs" || !event.sport?.url) return null;
  const home = event.actors?.find((a) => a.type === "home")?.label.trim();
  const away = event.actors?.find((a) => a.type === "away")?.label.trim();
  if (!home || !away) return null;
  const sport = canonicalSport(site.id, event.sport.url);
  const market = mainMarket(event, sport);
  const selections = market?.bets?.[0]?.selections ?? [];
  const expected = market?.selection_order_type === "1x2" ? 3 : 2;
  if (!market || selections.length !== expected) return null;
  const marketName = canonicalMarketName(selections.length);
  const odds: RawOdds[] = selections.map((s) => ({ market: marketName, selection: s.label.trim(), price: s.odds }));
  return {
    sport,
    competition: event.competition.label?.trim() ?? "",
    startTime: new Date(event.ts_start * 1000).toISOString(),
    participants: [home, away],
    odds,
    sourceId: String(event.id),
  };
}

export async function post(site: SportncoSite, path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${site.api}/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/plain, */*",
      "accept-language": "fr-FR",
      referer: site.referer,
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${site.id} ${path}: HTTP ${res.status}`);
  return res.json();
}

// Only the components asked for, not the whole page.
export const componentRequest = (urlKey: string, key: string) => ({
  context: { ...CONTEXT, url_key: urlKey },
  components: [{ tree_compo_key: key, params: null }],
});

async function competitionsOf(site: SportncoSite, sportKey: string): Promise<string[]> {
  return readCompetitions(
    await post(site, "component/data", componentRequest(sportKey, "menu_az_sportcatcomp")),
    sportKey
  );
}

// A failing tournament page costs only its tournaments: the matches are read all the same.
async function fetchTournaments(site: SportncoSite): Promise<RawEvent[]> {
  const pages = [...TOURNAMENT_PAGES, ...COMPETITION_PAGES];
  const read = await pool(pages, CONCURRENCY, async (url) =>
    readSportncoTournaments(await post(site, "component/data", componentRequest(url, "final_winner")), site)
  );
  return read.flatMap((r, i) => {
    if (r.status === "fulfilled") return r.value;
    console.warn(`[scraper:${site.id}] "${pages[i]}" failed, skipping it:`, r.reason);
    return [];
  });
}

export async function fetchSportnco(site: SportncoSite): Promise<RawEvent[]> {
  const sports = verifiedSportNames("sportnco").filter(
    (sport) => !TOURNAMENT_PAGES.includes(sport) && sport !== FORMULA_1_PAGE
  );
  const listed = await pool(sports, CONCURRENCY, (sportKey) => competitionsOf(site, sportKey));
  const competitions = listed.flatMap((r, i) => {
    if (r.status === "fulfilled") return r.value;
    console.warn(`[scraper:${site.id}] "${sports[i]}" failed, skipping it:`, r.reason);
    return [];
  });
  // Every sport failing is the bookmaker failing (runScrapeCycle retries it).
  if (listed.every((r) => r.status === "rejected")) throw new Error(`every ${site.id} sport failed`);
  const read = await pool(competitions, CONCURRENCY, async (url) =>
    readSportncoEvents(await post(site, "component/data", componentRequest(url, "prematch_event_list")), site)
  );
  const matches = read.flatMap((r, i) => {
    if (r.status === "fulfilled") return r.value;
    console.warn(`[scraper:${site.id}] "${competitions[i]}" failed, skipping it:`, r.reason);
    return [];
  });
  return [...matches, ...(await fetchTournaments(site))];
}

export const netbetScraper: BookmakerScraper = { id: NETBET.id, fetch: () => fetchSportnco(NETBET) };
export const genybetScraper: BookmakerScraper = { id: GENYBET.id, fetch: () => fetchSportnco(GENYBET) };
