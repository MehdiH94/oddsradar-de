import { exchangeFetch, exchangeWebSocket } from "./exchangeProxy";
// The reference's source: the Piwi247 exchange (Orbit's platform, Betfair's
// liquidity), read as a guest the way its own site does
// (https://exch.piwi247.com/customer/). An exchange's prices are set by the
// bettors themselves, with a margin of about 2% on a match's 1X2 against
// about 11% at Winamax and Betclic: mid prices without that margin are close
// to each outcome's real chances, the "fair odds" the dashboard shows next to
// the bookmakers' prices.
//
// Its site lists a sport's matches through a call it refuses to answer
// outside the site (405), so matches are found by name, with the site's own
// search, and priced through the socket its pages subscribe to.

const SITE = "https://exch.piwi247.com/customer/";
const API = `${SITE}api/`;
// SockJS's raw WebSocket transport: /<server>/<session>/websocket, any values.
const PRICES_SOCKET = "wss://exch.piwi247.com/customer/ws/multiple-market-prices";
const HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  accept: "application/json, text/plain, */*",
  origin: "https://exch.piwi247.com",
  referer: SITE,
};
const SOCCER = "1";
// The draw's runner on every Betfair Match Odds market.
const DRAW_RUNNER_NAME = "The Draw";

// A football match's Match Odds market on the exchange.
export interface ExchangeMatch {
  eventId: string;
  // Home first, as the exchange names them: "Poland U21", "Paris FC (W)".
  participants: [string, string];
  startTime: string;
  marketId: string;
  // The market's runners (selection ids): home team, away team, draw.
  runners: { home: number; away: number; draw: number };
}

interface SearchRunner {
  selectionId?: unknown;
  runnerName?: unknown;
}

// The football matches of a search's answer that have a Match Odds market.
export function parseSearch(body: unknown): ExchangeMatch[] {
  const content = (body as { content?: unknown })?.content;
  if (!Array.isArray(content)) return [];
  const matches: ExchangeMatch[] = [];
  for (const event of content) {
    if (event?.eventTypeId !== SOCCER || event.inPlay || typeof event.id !== "string") continue;
    const participants = typeof event.name === "string" ? event.name.split(" v ") : [];
    const market = Array.isArray(event.topMarkets)
      ? event.topMarkets.find((m: { description?: { marketType?: unknown } }) => m?.description?.marketType === "MATCH_ODDS")
      : undefined;
    if (participants.length !== 2 || typeof market?.marketId !== "string" || !Array.isArray(market.runners)) continue;
    // Its runners by the names the match's are read from, rather than by
    // their rank in the market: the outcomes can't be the other way round
    // from the names.
    const runners: SearchRunner[] = market.runners;
    const byName = (name: string) => runners.find((r) => r.runnerName === name.trim());
    const home = byName(participants[0]);
    const away = byName(participants[1]);
    const draw = byName(DRAW_RUNNER_NAME);
    const ids = [home?.selectionId, away?.selectionId, draw?.selectionId];
    if (!ids.every((id) => typeof id === "number") || draw === home || draw === away) continue;
    if (!Number.isFinite(event.openDate)) continue;
    matches.push({
      eventId: event.id,
      participants: [participants[0].trim(), participants[1].trim()],
      startTime: new Date(event.openDate).toISOString(),
      marketId: market.marketId,
      runners: { home: ids[0] as number, away: ids[1] as number, draw: ids[2] as number },
    });
  }
  return matches;
}

// The exchange's search, as it answers: the events of every sport whose
// names (or runners') have the query in them, 10 at most, or `size` of them:
// it takes a size with the first page only (the second answers an error,
// 6/10/2026).
export async function searchEvents(query: string, opts: { size?: number } = {}): Promise<unknown> {
  const size = opts.size ? `&page=0&size=${opts.size}` : "";
  const res = await exchangeFetch(`${API}event/search?query=${encodeURIComponent(query)}${size}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`exchange search "${query}": HTTP ${res.status}`);
  return res.json();
}

export async function searchExchange(query: string): Promise<ExchangeMatch[]> {
  return parseSearch(await searchEvents(query));
}

export interface RunnerPrices {
  back?: number;
  lay?: number;
  // The money offered at the best back and at the best lay, in euros.
  backSize?: number;
  laySize?: number;
}

export interface MarketPrices {
  runners: Map<number, RunnerPrices>;
  // An Asian line market's (a tennis match's games handicap and total): its
  // runners' prices at each line, by lineKey(runner, line). Its runners are
  // the same at every line, so `runners` keeps only the last line read.
  lines?: Map<string, RunnerPrices>;
  // Amount matched on the market so far, in euros.
  matched: number;
}

// A ladder of [price, size] offers: its best price, among those with money
// left, and the money offered at it.
function bestOf(ladder: unknown, pick: (prices: number[]) => number): { price?: number; size?: number } {
  if (!Array.isArray(ladder)) return {};
  const offers = ladder.filter(
    (offer): offer is [number, number] => Array.isArray(offer) && offer.length >= 2 && offer[1] > 0 && offer[0] > 1
  );
  if (offers.length === 0) return {};
  const price = pick(offers.map((offer) => offer[0]));
  const size = offers.filter((offer) => offer[0] === price).reduce((sum, offer) => sum + offer[1], 0);
  return { price, size };
}

export const lineKey = (selectionId: number, line: number) => `${selectionId}|${line}`;

// A runner of a market, at its line when it has one: an Asian line market's
// runners have the same id at every line.
const runnerKey = (id: number, line: unknown) => (typeof line === "number" ? lineKey(id, line) : String(id));

interface PriceFrame {
  id?: unknown;
  rc?: unknown;
  tv?: unknown;
  marketDefinition?: { status?: unknown; runners?: unknown };
  bettingEnabled?: unknown;
  enabled?: unknown;
  disabledLayOdds?: unknown;
}

// Whether the frame says bettors can bet on its market: true or false when it
// says, undefined when it says nothing (a frame of changes).
function openIn(f: PriceFrame): boolean | undefined {
  const status = f.marketDefinition?.status;
  const says = [typeof status === "string" ? status === "OPEN" : undefined, f.bettingEnabled, f.enabled].filter(
    (v): v is boolean => typeof v === "boolean"
  );
  return says.length === 0 ? undefined : says.every(Boolean);
}

// The socket's frames, by market: the best back (highest) and lay (lowest)
// price of each runner, from its combined ladders ("catb"/"catl", with
// cross-matching) or else its own ("atb"/"atl"). A later frame of a market
// replaces the runners it carries.
//
// A price the exchange shows greyed out, which nobody can take, is left out as
// if nobody offered it (14/10/2026: a surebet on Charleroi - Groningen's
// handicap rested on a line whose price was greyed out on the site). Greyed
// out are the runners it flags `locked`, those whose status is not ACTIVE
// (removed...), every runner of a market that is not OPEN or has its betting
// disabled, and a market's lays when it disables them.
export function parsePriceFrames(frames: readonly unknown[]): Map<string, MarketPrices> {
  const markets = new Map<string, MarketPrices>();
  const shut = new Set<string>();
  const inactive = new Map<string, Set<string>>();
  for (const frame of frames) {
    const f = frame as PriceFrame;
    if (typeof f?.id !== "string" || !Array.isArray(f.rc)) continue;
    const market: MarketPrices = markets.get(f.id) ?? { runners: new Map(), matched: 0 };
    const open = openIn(f);
    if (open !== undefined) {
      if (open) shut.delete(f.id);
      else {
        shut.add(f.id);
        market.runners.clear();
        market.lines?.clear();
      }
    }
    // A market's definition lists all its runners (at each line) and their status.
    if (Array.isArray(f.marketDefinition?.runners)) {
      inactive.set(
        f.id,
        new Set(
          (f.marketDefinition.runners as { id?: unknown; hc?: unknown; status?: unknown }[])
            .filter((r) => typeof r?.id === "number" && typeof r.status === "string" && r.status !== "ACTIVE")
            .map((r) => runnerKey(r.id as number, r.hc))
        )
      );
    }
    for (const r of f.rc) {
      if (typeof r?.id !== "number") continue;
      if (shut.has(f.id) || r.locked === true || inactive.get(f.id)?.has(runnerKey(r.id, r.hc))) {
        // Its last line read, if it has lines, is not this one's to forget.
        if (typeof r.hc === "number") market.lines?.delete(lineKey(r.id, r.hc));
        else market.runners.delete(r.id);
        continue;
      }
      const back = bestOf(r.catb ?? r.atb, (p) => Math.max(...p));
      const lay = f.disabledLayOdds === true ? {} : bestOf(r.catl ?? r.atl, (p) => Math.min(...p));
      const prices = { back: back.price, lay: lay.price, backSize: back.size, laySize: lay.size };
      market.runners.set(r.id, prices);
      if (typeof r.hc === "number") (market.lines ??= new Map()).set(lineKey(r.id, r.hc), prices);
    }
    const matched = Number(f.tv);
    if (Number.isFinite(matched)) market.matched = matched;
    markets.set(f.id, market);
  }
  return markets;
}

// Markets subscribed per socket: the site's pages ask for a few at a time,
// and the server closes a socket that asks too much (MARKET_LIMIT_EXCEEDED).
const MARKETS_PER_SOCKET = 20;
const SOCKET_TIMEOUT_MS = 8_000;

// The socket's frames for these markets: one per market as it subscribes,
// then its changes. Closed as soon as every market has answered.
function readSocket(markets: readonly { marketId: string; eventId: string }[], timeoutMs: number): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const frames: unknown[] = [];
    const answered = new Set<string>();
    const session = Math.random().toString(36).slice(2, 10);
    const server = Math.floor(Math.random() * 1000);
    const ws = exchangeWebSocket(`${PRICES_SOCKET}/${server}/${session}/websocket`);
    let opened = false;
    const finish = () => {
      clearTimeout(timer);
      ws.close();
      resolve(frames);
    };
    const timer = setTimeout(finish, timeoutMs);
    ws.onmessage = (message) => {
      const data = String(message.data);
      // SockJS: "o" once open, "h" heartbeats, "a[...]" a batch of messages.
      if (data === "o") {
        opened = true;
        ws.send(JSON.stringify([JSON.stringify(markets.map((m) => ({ ...m, applicationType: "WEB" })))]));
      } else if (data.startsWith("a")) {
        for (const text of JSON.parse(data.slice(1)) as string[]) {
          const frame = JSON.parse(text);
          frames.push(frame);
          if (typeof frame?.id === "string") answered.add(frame.id);
        }
        if (markets.every((m) => answered.has(m.marketId))) finish();
      }
    };
    ws.onerror = () => {
      if (opened) return;
      clearTimeout(timer);
      reject(new Error("exchange prices socket: connection failed"));
    };
    ws.onclose = () => {
      clearTimeout(timer);
      resolve(frames);
    };
  });
}

export async function fetchExchangePrices(
  markets: readonly { marketId: string; eventId: string }[],
  timeoutMs = SOCKET_TIMEOUT_MS
): Promise<Map<string, MarketPrices>> {
  const frames: unknown[] = [];
  for (let start = 0; start < markets.length; start += MARKETS_PER_SOCKET) {
    frames.push(...(await readSocket(markets.slice(start, start + MARKETS_PER_SOCKET), timeoutMs)));
  }
  return parsePriceFrames(frames);
}

// An outcome's lay may be at most this much above its back: past it, too few
// bettors are on the market for its prices to say much.
const MAX_SPREAD = 0.1;

export type Outcome = "1" | "X" | "2";

// Each outcome's fair odds: its mid price between best back and lay, all
// of a market's outcomes (a 1X2's three, a winner's two) scaled so that
// their chances add up to 100% (the margin removed). None when an outcome
// lacks a back or a lay, or its spread is too wide.
export function fairOddsOf<K extends string>(
  prices: Record<K, RunnerPrices | undefined>,
  outcomes: readonly K[]
): Record<K, number> | null {
  const mids: number[] = [];
  for (const outcome of outcomes) {
    const { back, lay } = prices[outcome] ?? {};
    // (With a hair of slack for floating point: 2.2 / 2 - 1 is 0.1000...09.)
    if (!back || !lay || lay < back || lay - back > back * MAX_SPREAD + 1e-9) return null;
    mids.push((back + lay) / 2);
  }
  const total = mids.reduce((sum, mid) => sum + 1 / mid, 0);
  return Object.fromEntries(outcomes.map((outcome, i) => [outcome, mids[i] * total])) as Record<K, number>;
}

// A football 1X2's.
export function fairOdds(prices: Record<Outcome, RunnerPrices | undefined>): Record<Outcome, number> | null {
  return fairOddsOf(prices, ["1", "X", "2"]);
}

// --- the players' markets (event/details) -------------------------------------

// The exchange's players' markets the bookmakers have too, by our catalog's
// market keys (src/markets/catalog.ts): "scorer_goals|2" is at least 2 goals.
// Its players' shots on target have no bookmaker counterpart.
export const PLAYER_MARKETS: Record<string, string> = {
  TO_SCORE: "anytime_scorer",
  FIRST_GOAL_SCORER: "first_scorer",
  TO_SCORE_2_OR_MORE: "scorer_goals|2",
  TO_SCORE_HATTRICK: "scorer_goals|3",
  // A golf tournament's Top 5, 10 and 20 (6/10/2026): several winners, like a
  // scorers' market, priced by player. Its round leader is too thin to say
  // anything (spreads of 40% and more), its each way is another bet.
  TOP_5_FINISH: "golf_top|5",
  TOP_10_FINISH: "golf_top|10",
  TOP_20_FINISH: "golf_top|20",
};
// First goalscorer's runner for a match without a goal.
const NO_GOALSCORER = "No Goalscorer";

// One of a match's players' markets on the exchange.
export interface ExchangePlayerMarket {
  // Our market key ("anytime_scorer"...).
  market: string;
  marketId: string;
  // Its players: selection id -> the exchange's name ("Ousmane Dembele").
  runners: Record<number, string>;
}

// The players' markets of an event/details answer, if the exchange lists
// them yet: it adds them a day or two before kick-off.
export function parseEventPlayerMarkets(body: unknown): ExchangePlayerMarket[] {
  const catalogues = (body as { marketCatalogues?: unknown })?.marketCatalogues;
  if (!Array.isArray(catalogues)) return [];
  const markets: ExchangePlayerMarket[] = [];
  for (const m of catalogues) {
    const market = PLAYER_MARKETS[m?.description?.marketType];
    if (!market || typeof m.marketId !== "string" || !Array.isArray(m.runners)) continue;
    const runners: Record<number, string> = {};
    for (const r of m.runners as SearchRunner[]) {
      if (typeof r.selectionId === "number" && typeof r.runnerName === "string" && r.runnerName !== NO_GOALSCORER) {
        runners[r.selectionId] = r.runnerName;
      }
    }
    if (Object.keys(runners).length > 0) markets.push({ market, marketId: m.marketId, runners });
  }
  return markets;
}

// An event's markets, as the exchange answers (event/details).
export async function fetchEventDetails(eventId: string): Promise<unknown> {
  const res = await exchangeFetch(`${API}event/details/${encodeURIComponent(eventId)}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`exchange event ${eventId}: HTTP ${res.status}`);
  return res.json();
}

export async function fetchEventPlayerMarkets(eventId: string): Promise<ExchangePlayerMarket[]> {
  return parseEventPlayerMarkets(await fetchEventDetails(eventId));
}

// How far a player's prices can be trusted. "shown", at most 20% apart with
// 20 EUR on both sides, makes the fair odds the dashboard shows: a players'
// market moves more than a 1X2, its prices are wider. The others are only
// counted (src/db/playerStats.ts): "strict" as tight as a 1X2's, "spread"
// as tight whatever the money, "loose" as wide with 10 EUR, "priced" any back
// and lay.
export interface Reliability {
  priced: boolean;
  loose: boolean;
  shown: boolean;
  spread: boolean;
  strict: boolean;
}

export const RELIABILITY = {
  shown: { maxSpread: 0.2, minSize: 20 },
  strict: { maxSpread: 0.1, minSize: 20 },
  spread: { maxSpread: 0.1, minSize: 0 },
  loose: { maxSpread: 0.2, minSize: 10 },
} as const;

// A runner's spread: how far its best lay is above its best back.
export const spreadOf = ({ back, lay }: RunnerPrices): number | undefined =>
  back && lay && lay >= back ? lay / back - 1 : undefined;

// The money offered on its thinner side.
export const sizeOf = ({ backSize, laySize }: RunnerPrices): number => Math.min(backSize ?? 0, laySize ?? 0);

export function playerReliability(prices: RunnerPrices): Reliability {
  const spread = spreadOf(prices);
  const size = sizeOf(prices);
  // (With a hair of slack for floating point, like fairOdds.)
  const fits = ({ maxSpread, minSize }: { maxSpread: number; minSize: number }) =>
    spread !== undefined && spread <= maxSpread + 1e-9 && size >= minSize;
  return {
    priced: spread !== undefined,
    loose: fits(RELIABILITY.loose),
    shown: fits(RELIABILITY.shown),
    spread: fits(RELIABILITY.spread),
    strict: fits(RELIABILITY.strict),
  };
}

// A player's fair odds: the mid price between best back and lay. Not scaled
// like the 1X2's: a scorer's market has several winners.
export const midPrice = ({ back, lay }: RunnerPrices): number | undefined => (back && lay ? (back + lay) / 2 : undefined);
