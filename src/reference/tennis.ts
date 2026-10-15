import { normalizeName } from "../matcher/normalize";
import { exchangeFetch } from "./exchangeProxy";
import { coversEveryCase, marketKey } from "../markets/catalog";
import { MARKET_MATCH_WINNER } from "../scraper/canonical";
import { lineKey, MarketPrices, playerReliability, RunnerPrices } from "./exchange";

// The reference for the main tours' tennis matches (src/markets/tennis.ts):
// the exchange's Match Odds, games handicap and total, sets... read like the
// football 1X2 (./exchange.ts), as a guest. Captured on Vekic - Swiatek
// (4/10/2026, tests/reference/fixtures/exchange-tennis-*).

const SITE = "https://exch.piwi247.com/customer/";
const API = `${SITE}api/`;
const HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  accept: "application/json, text/plain, */*",
  origin: "https://exch.piwi247.com",
  referer: SITE,
};
const TENNIS = "2";

// --- finding a match ---------------------------------------------------------

// A tennis match on the exchange, its players as it names them: "Vekic v
// Iga Swiatek", "Alex de Minaur v Hurkacz", "M Bouzkova v Q Zheng".
export interface TennisExchangeEvent {
  eventId: string;
  players: [string, string];
}

export function parseTennisSearch(body: unknown): TennisExchangeEvent[] {
  const content = (body as { content?: unknown })?.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((event): TennisExchangeEvent[] => {
    if (event?.eventTypeId !== TENNIS || event.inPlay || typeof event.id !== "string" || typeof event.name !== "string") {
      return [];
    }
    const players = event.name.split(" v ").map((p: string) => p.trim());
    // A doubles match names its pairs "A/B".
    if (players.length !== 2 || players.some((p: string) => !p || p.includes("/"))) return [];
    return [{ eventId: event.id, players: [players[0], players[1]] }];
  });
}

export async function searchTennis(query: string): Promise<TennisExchangeEvent[]> {
  const res = await exchangeFetch(`${API}event/search?query=${encodeURIComponent(query)}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`exchange search "${query}": HTTP ${res.status}`);
  return parseTennisSearch(await res.json());
}

const words = (name: string) => normalizeName(name).split(" ").filter(Boolean);

// What a player is searched by: their surname, "Jannik Sinner" -> "sinner".
export function playerSearchTerm(name: string): string | undefined {
  return words(name).at(-1);
}

// The same player, the exchange naming them by their surname alone, with an
// initial or a shorter first name: "Iga Swiatek" is "Iga Swiatek", "Swiatek"
// and "I Swiatek"; "Xinran Sun" is "Xin Sun"; "Alex De Minaur" is "Alex de
// Minaur".
export function samePlayer(ours: string, theirs: string): boolean {
  const a = words(ours);
  const b = words(theirs);
  if (a.length === 0 || b.length === 0 || a.at(-1) !== b.at(-1)) return false;
  if (a.length === 1 || b.length === 1) return true;
  const [first, other] = [a[0], b[0]];
  return other.length === 1 ? first[0] === other : first.startsWith(other) || other.startsWith(first);
}

// Our match among the exchange's, and whether the exchange names its players
// the other way round.
export function placeTennisMatch(
  participants: readonly string[],
  candidates: readonly TennisExchangeEvent[]
): { event: TennisExchangeEvent; reversed: boolean } | undefined {
  const [one, two] = participants;
  if (!one || !two) return undefined;
  for (const event of candidates) {
    const [a, b] = event.players;
    if (samePlayer(one, a) && samePlayer(two, b)) return { event, reversed: false };
    if (samePlayer(one, b) && samePlayer(two, a)) return { event, reversed: true };
  }
  return undefined;
}

// --- its markets -------------------------------------------------------------

export interface TennisRunner {
  selectionId: number;
  name: string;
  // An Asian line market's line: a player's own games handicap, a total.
  handicap: number;
  side?: "OVER" | "UNDER";
}

export interface TennisMarket {
  marketId: string;
  type: string;
  name: string;
  runners: TennisRunner[];
}

export interface TennisMarkets {
  // The exchange's own names of its players, first one first ("player A").
  players: [string, string];
  markets: TennisMarket[];
}

// The exchange's markets we have a family for (src/markets/catalog.ts).
const TYPES = new Set([
  "MATCH_ODDS",
  "HANDICAP",
  "COMBINED_TOTAL",
  "SET_BETTING",
  "NUMBER_OF_SETS",
  "SET_WINNER",
  "PLAYER_A_WIN_A_SET",
  "PLAYER_B_WIN_A_SET",
]);

export function parseTennisMarkets(body: unknown): TennisMarkets | undefined {
  const b = body as { eventInfo?: { name?: unknown }; marketCatalogues?: unknown };
  const players = typeof b?.eventInfo?.name === "string" ? b.eventInfo.name.split(" v ").map((p) => p.trim()) : [];
  if (players.length !== 2 || !Array.isArray(b.marketCatalogues)) return undefined;
  const markets = b.marketCatalogues.flatMap((m): TennisMarket[] => {
    const type = m?.description?.marketType;
    if (!TYPES.has(type) || typeof m.marketId !== "string" || !Array.isArray(m.runners)) return [];
    const runners = m.runners.flatMap((r: Record<string, unknown>): TennisRunner[] =>
      typeof r?.selectionId === "number" && typeof r.runnerName === "string"
        ? [
            {
              selectionId: r.selectionId,
              name: r.runnerName,
              handicap: typeof r.handicap === "number" ? r.handicap : 0,
              ...(r.lineSide === "OVER" || r.lineSide === "UNDER" ? { side: r.lineSide } : {}),
            },
          ]
        : []
    );
    return [{ marketId: m.marketId, type, name: String(m.marketName ?? ""), runners }];
  });
  return { players: [players[0], players[1]], markets };
}

export async function fetchTennisMarkets(eventId: string): Promise<TennisMarkets | undefined> {
  const res = await exchangeFetch(`${API}event/details/${encodeURIComponent(eventId)}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`exchange event ${eventId}: HTTP ${res.status}`);
  return parseTennisMarkets(await res.json());
}

// --- our markets -------------------------------------------------------------

// One of our outcomes, priced by one of the exchange's runners (at a line).
export interface TennisPoint {
  market: string;
  selection: string;
  marketId: string;
  selectionId: number;
  line?: number;
}

const SET_COUNTS: Record<string, string> = { two: "2", three: "3", four: "4", five: "5" };
const isHalf = (line: number) => Number.isFinite(line) && Math.abs(line % 1) === 0.5;

// Each of our outcomes the exchange prices, in our players' order: "1" is
// the event's first participant, the exchange's player B when `reversed`.
export function tennisPoints(markets: TennisMarkets, reversed: boolean): TennisPoint[] {
  const [a, b] = markets.players;
  const ours = (side: "A" | "B") => ((side === "A") !== reversed ? "1" : "2");
  // Which player a runner is: "Donna Vekic", "Vekic -11.5", "Iga Swiatek 2-0".
  const sideOf = (name: string): "A" | "B" | undefined => {
    const player = name.replace(/\s+([+-]?\d+(\.\d+)?|\d-\d)$/, "");
    const isA = samePlayer(a, player);
    const isB = samePlayer(b, player);
    return isA === isB ? undefined : isA ? "A" : "B";
  };
  const points: TennisPoint[] = [];
  const add = (market: string, selection: string, m: TennisMarket, r: TennisRunner, line?: number) =>
    points.push({ market, selection, marketId: m.marketId, selectionId: r.selectionId, ...(line === undefined ? {} : { line }) });

  for (const m of markets.markets) {
    for (const r of m.runners) {
      switch (m.type) {
        case "MATCH_ODDS":
        case "SET_WINNER": {
          const set = /^Set (\d) Winner$/.exec(m.name)?.[1];
          const market = m.type === "MATCH_ODDS" ? MARKET_MATCH_WINNER : set === "1" || set === "2" ? `set${set}_winner` : undefined;
          const side = sideOf(r.name);
          if (market && side) add(market, ours(side), m, r);
          break;
        }
        case "HANDICAP": {
          // The runner's own handicap; ours is the first player's.
          const side = sideOf(r.name);
          if (!side || !isHalf(r.handicap)) break;
          const player = ours(side);
          add(marketKey("games_handicap", player === "1" ? r.handicap : -r.handicap), player, m, r, r.handicap);
          break;
        }
        case "COMBINED_TOTAL":
          if (r.side && isHalf(r.handicap)) add(marketKey("total_games", r.handicap), r.side.toLowerCase(), m, r, r.handicap);
          break;
        case "SET_BETTING": {
          // "Vekic 2-1": that player wins 2 sets to 1; ours from player 1's side.
          const score = /(\d)-(\d)$/.exec(r.name);
          const side = sideOf(r.name);
          if (!score || !side) break;
          add("set_betting", ours(side) === "1" ? `${score[1]}-${score[2]}` : `${score[2]}-${score[1]}`, m, r);
          break;
        }
        case "NUMBER_OF_SETS": {
          const count = SET_COUNTS[normalizeName(r.name).split(" ")[0]];
          if (count) add("exact_sets", count, m, r);
          break;
        }
        case "PLAYER_A_WIN_A_SET":
        case "PLAYER_B_WIN_A_SET": {
          // "Yes", "Iga Swiatek Yes".
          const answer = /\b(yes|no)$/i.exec(r.name)?.[1].toLowerCase();
          if (answer) add(`win_a_set@${ours(m.type === "PLAYER_A_WIN_A_SET" ? "A" : "B")}`, answer, m, r);
          break;
        }
      }
    }
  }
  return points;
}

// --- fair odds ---------------------------------------------------------------

export interface TennisPrice {
  market: string;
  selection: string;
  back?: number;
  lay?: number;
  backSize?: number;
  laySize?: number;
  // The outcome's fair odds, when its market's prices are reliable enough.
  fair?: number;
  matched: number;
}

// Whether a market's prices make fair odds: the winner's as tight as a 1X2's
// (back and lay 10% apart at most); the others' like a player's (20% apart,
// 20 EUR on each side), their bets moving more.
function reliable(market: string, prices: RunnerPrices): boolean {
  const r = playerReliability(prices);
  return market === MARKET_MATCH_WINNER ? r.spread : r.shown;
}

// Every point's prices, and the fair odds of each market whose outcomes are
// all priced reliably: their mid prices, without the exchange's margin.
export function tennisPrices(points: readonly TennisPoint[], markets: ReadonlyMap<string, MarketPrices>): TennisPrice[] {
  const byMarket = new Map<string, TennisPrice[]>();
  for (const p of points) {
    const market = markets.get(p.marketId);
    if (!market) continue;
    const prices = p.line === undefined ? market.runners.get(p.selectionId) : market.lines?.get(lineKey(p.selectionId, p.line));
    if (!prices || (prices.back === undefined && prices.lay === undefined)) continue;
    const row: TennisPrice = { market: p.market, selection: p.selection, ...prices, matched: market.matched };
    byMarket.set(p.market, [...(byMarket.get(p.market) ?? []), row]);
  }
  for (const [market, rows] of byMarket) {
    const family = market.split("|")[0];
    const complete =
      market === MARKET_MATCH_WINNER
        ? rows.length === 2 && new Set(rows.map((r) => r.selection)).size === 2
        : coversEveryCase(family, rows.map((r) => r.selection));
    if (!complete || !rows.every((r) => r.back !== undefined && r.lay !== undefined && reliable(market, r))) continue;
    const implied = rows.map((r) => 2 / (r.back! + r.lay!));
    const total = implied.reduce((s, p) => s + p, 0);
    rows.forEach((r, i) => (r.fair = total / implied[i]));
  }
  return [...byMarket.values()].flat();
}
