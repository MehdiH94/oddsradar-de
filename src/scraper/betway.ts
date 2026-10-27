import { RawEvent, RawOdds } from "../types";
import { BookmakerScraper } from "./run";
import { BookmakerId, canonicalMarketName, canonicalSport } from "./canonical";
import { netOfStakeTax } from "./stakeTax";
import { teamName } from "./twentybet";
import { validateRawEvent } from "./validateRawEvent";

// Betway.de's prices, from the API its site reads them from
// (betway.de/de/api/sports/content, its pages' own, 27/10/2026;
// tests/scraper/fixtures/betway-*.json were read from its predecessor,
// services/api/events/v2, whose answers are the same): JSON POSTs, without an
// account or a cookie. No challenge stands in front of it. The old API's
// markets method has answered 410 "gone" since about 22/10/2026, which is
// when Betway went silent; its other methods still answered, the new ones
// are used throughout.
//
// The API lists a sport's matches by competition only: its competitions
// (GetCategoryDetails), then each one's matches (GetGroup), about 250 requests
// for every sport read. That list is read again every LIST_REFRESH_MS, and
// between two, every cycle adds the next 24 hours' matches
// (GetUpcoming, one request a sport). The prices, every cycle: the main
// market of 200 matches a request (GetEventsWithMultipleMarkets, which answers
// 400 markets at most, half of it asked).

const API = "https://betway.de/de/api/sports/content";
// The site's own parameters: German brand and jurisdiction, the names in
// English (the exchange's and the other bookmakers', src/matcher/).
const SITE = { PremiumOnly: false, LanguageId: 1, ClientTypeId: 2, BrandId: 3, JurisdictionId: 3, ClientIntegratorId: 1 };

// The German betting tax, 5.3%. Taken off the whole price, as for
// bet-at-home.de (./betathome.ts): a price never shows more than it pays.
export const BETWAY_TAX = 0.053;

const LIST_REFRESH_MS = 30 * 60 * 1000;
// The API's most markets asked at once: matches times market names.
const MAX_MARKETS = 400;
const REQUEST_DELAY_MS = 300;
// A stalled request must fail rather than hang: the worker's overlap guard
// would otherwise skip every later cycle, for every bookmaker.
const REQUEST_TIMEOUT_MS = 30_000;

// The sports read, by the API's category: its main market and outcomes (a
// "Win/Draw/Win" is the result in ordinary time, the project's 1X2; a "Match
// Winner" or "Money Line" the winner, overtime included), under each name a
// sport gives it: basketball's is the "money-line" of the American leagues,
// the "basketball-match-winner" of the others. Verified on the matches of
// 19/10/2026.
export const BETWAY_SPORTS: Readonly<Record<string, { markets: readonly string[]; outcomes: 2 | 3 }>> = {
  soccer: { markets: ["win-draw-win"], outcomes: 3 },
  tennis: { markets: ["match-winner"], outcomes: 2 },
  basketball: { markets: ["money-line", "basketball-match-winner"], outcomes: 2 },
  "ice-hockey": { markets: ["win-draw-win"], outcomes: 3 },
  "american-football": { markets: ["money-line"], outcomes: 2 },
  handball: { markets: ["win-draw-win"], outcomes: 3 },
  volleyball: { markets: ["match-winner"], outcomes: 2 },
  darts: { markets: ["match-winner"], outcomes: 2 },
  "rugby-union": { markets: ["win-draw-win"], outcomes: 3 },
  "rugby-league": { markets: ["win-draw-win"], outcomes: 3 },
};

// A sport's virtual matches, filed as a country of their own ("esoccer",
// "ebasketball": video game players behind the teams' names).
const isVirtual = (subCategory: string | undefined) => /^e(soccer|basketball|american-football|ice-hockey|tennis)$/.test(subCategory ?? "");

export interface BetwayCategoryDetails {
  SubCategories?: { SubCategoryCName?: string; Groups?: { GroupCName?: string; FixturesCount?: number }[] }[];
}
export interface BetwayEventList {
  EventSummaries?: { EventId?: number; IsOutright?: boolean }[];
}
export interface BetwayMarkets {
  Events?: {
    Id?: number;
    CategoryCName?: string;
    SubCategoryCName?: string;
    SubCategoryName?: string;
    GroupName?: string;
    HomeTeamName?: string;
    AwayTeamName?: string;
    Milliseconds?: number;
    IsLive?: boolean;
    IsSuspended?: boolean;
    IsOutright?: boolean;
  }[];
  Markets?: {
    EventId?: number;
    MarketCName?: string;
    IsSuspended?: boolean;
    OutcomeGroups?: Record<string, { outcomes?: number[] }>;
  }[];
  Outcomes?: { Id?: number; BetName?: string; OddsDecimal?: number; IsActive?: boolean; IsDisplay?: boolean }[];
}

// The competition a match is in: its group's name, or for the sports whose
// groups are all "Matches" (rugby's, darts'), its subcategory's.
const competitionOf = (group: string | undefined, subCategory: string | undefined): string =>
  (!group || /^matches$/i.test(group) ? (subCategory ?? "") : group).trim();

// The matches of an answer as raw events: each one not yet started with its
// main market, labelled with the teams' names and "Draw" (the matcher reads
// them as 1, X and 2), the prices net of the tax. A market without one active
// price per outcome leaves the match out.
export function parseBetwayMarkets(reply: BetwayMarkets, category: string, now = Date.now()): RawEvent[] {
  const config = BETWAY_SPORTS[category];
  if (!config) return [];
  const outcomes = new Map((reply.Outcomes ?? []).map((o) => [o.Id, o]));
  const markets = new Map((reply.Markets ?? []).filter((m) => config.markets.includes(m.MarketCName ?? "")).map((m) => [m.EventId, m]));
  const events: RawEvent[] = [];
  for (const event of reply.Events ?? []) {
    try {
      if (event.CategoryCName !== category || event.IsLive || event.IsOutright || isVirtual(event.SubCategoryCName)) continue;
      if (typeof event.Milliseconds !== "number" || event.Milliseconds <= now) continue;
      const market = markets.get(event.Id);
      if (!market || market.IsSuspended || event.IsSuspended) continue;
      const competition = competitionOf(event.GroupName, event.SubCategoryName);
      const [homeName, awayName] = [event.HomeTeamName?.trim(), event.AwayTeamName?.trim()];
      if (!homeName || !awayName) continue;
      const [home, away] = [teamName(homeName, competition), teamName(awayName, competition)];
      const names: Record<string, string> = { home, draw: "Draw", away };
      const sides = Object.entries(market.OutcomeGroups ?? {});
      if (sides.length !== config.outcomes) continue;
      const marketName = canonicalMarketName(config.outcomes);
      const odds: RawOdds[] = sides.map(([side, group]) => {
        const selection = names[side];
        const ids = group.outcomes ?? [];
        const outcome = outcomes.get(ids[0]);
        // A side is the team it names: an American match lists its prices
        // away team first, which must not swap them.
        const named = side === "draw" ? /^(draw|tie)$/i.test(outcome?.BetName ?? "") : outcome?.BetName?.trim() === (side === "home" ? homeName : awayName);
        if (!selection || ids.length !== 1 || !named) throw new Error(`unexpected side "${side}": "${outcome?.BetName}"`);
        const price = outcome?.IsActive && outcome.IsDisplay && typeof outcome.OddsDecimal === "number" ? outcome.OddsDecimal : NaN;
        return { market: marketName, selection, price: netOfStakeTax(price, BETWAY_TAX) };
      });
      const raw: RawEvent = {
        sport: canonicalSport("betway", category),
        competition,
        startTime: new Date(event.Milliseconds).toISOString(),
        participants: [home, away],
        odds,
        sourceId: String(event.Id),
      };
      const checked = validateRawEvent(raw, "betway");
      if (checked) events.push(checked);
    } catch (err) {
      // One malformed match must not take down the rest of the list.
      console.warn(`[scraper:betway] failed to read match ${event?.Id}, skipping it:`, err);
    }
  }
  return events;
}

// The ids of a list's matches (its competitions' winners left out).
const matchIds = (list: BetwayEventList): number[] =>
  (list.EventSummaries ?? []).flatMap((e) => (!e.IsOutright && typeof e.EventId === "number" ? [e.EventId] : []));

// The groups of a sport with matches to come, its virtual ones left out.
export const groupsOf = (details: BetwayCategoryDetails): { sub: string; group: string }[] =>
  (details.SubCategories ?? []).flatMap((s) =>
    isVirtual(s.SubCategoryCName)
      ? []
      : (s.Groups ?? []).flatMap((g) => ((g.FixturesCount ?? 0) > 0 && s.SubCategoryCName && g.GroupCName ? [{ sub: s.SubCategoryCName, group: g.GroupCName }] : []))
  );

export type BetwayPost = <T>(method: string, body: Record<string, unknown>) => Promise<T>;

const HEADERS = {
  accept: "application/json",
  "accept-language": "de-DE",
  "content-type": "application/json",
  origin: "https://betway.de",
  referer: "https://betway.de/de/de/sports",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
};

// The methods keep the old API's names here ("GetGroup"); the new one spells
// them in camel case ("getGroup").
export const betwayPath = (method: string): string => `${API}/${method.charAt(0).toLowerCase()}${method.slice(1)}`;

const platformPost: BetwayPost = async <T>(method: string, body: Record<string, unknown>): Promise<T> => {
  const res = await fetch(betwayPath(method), {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ ...SITE, CorrelationId: crypto.randomUUID(), ...body }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`betway ${method}: HTTP ${res.status}`);
  const reply = (await res.json()) as T & { Success?: boolean; Errors?: { Message?: string }[] };
  if (reply.Success === false) throw new Error(`betway ${method}: ${reply.Errors?.[0]?.Message ?? "failed"}`);
  return reply;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Each sport's matches as last listed in full, and when.
const listed = new Map<string, { ids: Set<number>; at: number }>();

// A sport's matches: its full list, read again when old, and the next 24 hours'.
async function idsOf(post: BetwayPost, category: string, now: number, delayMs: number): Promise<number[]> {
  let full = listed.get(category);
  if (!full || now - full.at >= LIST_REFRESH_MS) {
    const ids = new Set<number>();
    const details = await post<BetwayCategoryDetails>("GetCategoryDetails", { CategoryCName: category });
    for (const { sub, group } of groupsOf(details)) {
      await sleep(delayMs);
      try {
        const list = await post<BetwayEventList>("GetGroup", { CategoryCName: category, SubCategoryCName: sub, GroupCName: group });
        for (const id of matchIds(list)) ids.add(id);
      } catch (err) {
        // One competition failing costs only its own matches.
        console.warn(`[scraper:betway] ${category}/${sub}/${group} failed, skipping it:`, err);
      }
    }
    listed.set(category, (full = { ids, at: now }));
  }
  await sleep(delayMs);
  const upcoming = matchIds(await post<BetwayEventList>("GetUpcoming", { CategoryCName: category }));
  return [...new Set([...full.ids, ...upcoming])];
}

async function fetchSport(post: BetwayPost, category: string, now: number, delayMs: number): Promise<RawEvent[]> {
  const ids = await idsOf(post, category, now, delayMs);
  const { markets } = BETWAY_SPORTS[category];
  const batch = Math.floor(MAX_MARKETS / markets.length / 2);
  const events: RawEvent[] = [];
  for (let i = 0; i < ids.length; i += batch) {
    await sleep(delayMs);
    const reply = await post<BetwayMarkets>("GetEventsWithMultipleMarkets", {
      // Without IncludeAllMarkets the new API answers no market at all; with
      // it, the asked markets' family ("win-draw-win-1up"…), of which
      // parseBetwayMarkets keeps the asked one.
      EventMarketSets: [{ EventIds: ids.slice(i, i + batch), IncludeAllMarkets: true, MarketCNames: markets }],
      ScoreboardRequest: { ScoreboardType: 0, IncidentRequest: {} },
    });
    events.push(...parseBetwayMarkets(reply, category, now));
  }
  return events;
}

export async function fetchBetway(opts: { post?: BetwayPost; now?: () => number; delayMs?: number } = {}): Promise<RawEvent[]> {
  const post = opts.post ?? platformPost;
  const now = (opts.now ?? Date.now)();
  const sports = Object.keys(BETWAY_SPORTS);
  const read = [];
  // One sport after the other.
  for (const category of sports) {
    read.push(await fetchSport(post, category, now, opts.delayMs ?? REQUEST_DELAY_MS).then((value) => ({ ok: true as const, value }), (reason) => ({ ok: false as const, reason })));
  }
  // Every sport failing is the bookmaker failing (runScrapeCycle retries it);
  // one failing costs only its own matches.
  // The first sport's cause goes with it, so that the bookmakers' report
  // (npm run bookmaker-status) says why.
  if (read.every((r) => !r.ok)) {
    const first = read[0];
    const cause = first && !first.ok ? (first.reason instanceof Error ? first.reason.message : String(first.reason)) : "";
    throw new Error(`every betway sport failed (${sports[0]}: ${cause})`);
  }
  return read.flatMap((r, i) => {
    if (!r.ok) {
      console.warn(`[scraper:betway] sport ${sports[i]} failed, skipping it:`, r.reason);
      return [];
    }
    return r.value;
  });
}

// The full lists read so far, forgotten (the tests' fresh start).
export const forgetBetwayLists = (): void => listed.clear();

export const betwayScraper: BookmakerScraper = { id: "betway" satisfies BookmakerId, fetch: fetchBetway };
