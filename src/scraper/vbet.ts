import { RawEvent, RawOdds } from "../types";
import { BookmakerScraper } from "./run";
import { canonicalMarketName } from "./canonical";
import { netOfStakeTax } from "./stakeTax";
import { teamName } from "./twentybet";
import { validateRawEvent } from "./validateRawEvent";

// VBET.de's prices, from the websocket its site reads them from
// (BetConstruct's "Swarm", wss://eu-swarm-reverse.betconstruct.com/, the
// "swarmUrl" of the page's own settings, seen in its pages' traffic,
// 21/10/2026, tests/scraper/fixtures/vbet-*.json): JSON messages, without an
// account, a cookie or a token. The page opens a session for its site
// ("springConfig.partnerId", request_session), then asks for what it shows
// with "get" commands; nothing stands in front of it.
//
// A sport's matches before kick-off with their main market, in one answer
// (the server has no pages: football's 900 matches are 900 kB).

const WS_URL = "wss://eu-swarm-reverse.betconstruct.com/";
const ORIGIN = "https://www.vbet.de";
// VBET.de's site id on the server: the page's springConfig.partnerId.
const SITE_ID = 18764169;
// The names in English (the exchange's and the other bookmakers',
// src/matcher/); the site itself asks for "ger".
const LANGUAGE = "eng";
// The session's source, as the site's page sends it.
const SOURCE = 42;

// The German betting tax, 5.3% "included in the stake": the site's own
// settings say "tax_type": 4, "tax_percent": 5.033238 (that is 5.3 / 105.3),
// and its bet slip takes 0.50 off a 10.00 stake, the winnings being the
// price times the 9.50 left (21/10/2026). The prices it shows are before it;
// they are stored net of it (./stakeTax.ts).
export const VBET_TAX = 0.05033238;

const REQUEST_DELAY_MS = 300;
// A stalled request must fail rather than hang: the worker's overlap guard
// would otherwise skip every later cycle, for every bookmaker.
const REQUEST_TIMEOUT_MS = 30_000;

// The sports read, by the server's alias: the project's sport (src/scraper/
// canonical.ts's keys), its main market's type and outcomes (a "P1XP2" is the
// result in ordinary time, the project's 1X2: "Match Result", "Match Result
// (Regular Time)" for ice hockey; a "P1P2" the winner, overtime included:
// "Match Winner", "Money Line (Including Overtime)"). Verified with the
// server's get_market_type and on the matches of 21/10/2026.
export const VBET_SPORTS: Readonly<Record<string, { sport: string; market: "P1XP2" | "P1P2"; outcomes: 2 | 3 }>> = {
  Soccer: { sport: "football", market: "P1XP2", outcomes: 3 },
  Tennis: { sport: "tennis", market: "P1P2", outcomes: 2 },
  Basketball: { sport: "basketball", market: "P1P2", outcomes: 2 },
  IceHockey: { sport: "hockey sur glace", market: "P1XP2", outcomes: 3 },
  Handball: { sport: "handball", market: "P1XP2", outcomes: 3 },
  Volleyball: { sport: "volley-ball", market: "P1P2", outcomes: 2 },
  AmericanFootball: { sport: "football américain", market: "P1P2", outcomes: 2 },
  Darts: { sport: "fléchettes", market: "P1P2", outcomes: 2 },
  RugbyUnion: { sport: "rugby à xv", market: "P1XP2", outcomes: 3 },
  RugbyLeague: { sport: "rugby à xiii", market: "P1XP2", outcomes: 3 },
};

// What an answer gives of a match, the rest left out. Its game "type" is 0
// for a match before kick-off, 2 for one that will also be offered live, 1
// for a live one.
export interface VbetEvent {
  id?: number;
  name?: string;
  type?: string;
  price?: number;
}
export interface VbetMarket {
  id?: number;
  name?: string;
  type?: string;
  event?: Record<string, VbetEvent>;
}
export interface VbetGame {
  id?: number;
  team1_name?: string;
  team2_name?: string;
  start_ts?: number;
  type?: number;
  is_started?: number;
  is_blocked?: number;
  market?: Record<string, VbetMarket>;
}
export interface VbetReply {
  data?: {
    sport?: Record<
      string,
      {
        alias?: string;
        region?: Record<string, { name?: string; competition?: Record<string, { name?: string; game?: Record<string, VbetGame> }> }>;
      }
    >;
  };
}

// The "get" of a sport's matches before kick-off with their main market, as
// the site's own match lists ask it.
export const vbetGamesQuery = (alias: string): Record<string, unknown> => ({
  source: "betting",
  what: {
    sport: ["id", "alias"],
    region: ["id", "name"],
    competition: ["id", "name"],
    game: ["id", "team1_name", "team2_name", "start_ts", "type", "is_started", "is_blocked"],
    market: ["id", "name", "type"],
    event: ["id", "name", "type", "price"],
  },
  where: {
    sport: { alias },
    game: { type: { "@in": [0, 2] } },
    market: { type: VBET_SPORTS[alias].market },
  },
  subscribe: false,
});

// A participant's name as the other bookmakers write it: a women's team with
// "(W)" rather than "(Wom)", without the double spaces some names carry.
const nameOf = (raw: string): string =>
  raw
    .replace(/\s*\(Wom\)\s*$/i, " (W)")
    .replace(/\s+/g, " ")
    .trim();

// The outcome an event is, by its type: P1 the team named first, X the draw.
const SIDES: Record<string, 0 | 1 | 2> = { P1: 0, X: 1, P2: 2 };

// The matches of a sport's answer as raw events: each match not yet started
// with its main market, labelled with the teams' names and "Draw" (the matcher
// reads them as 1, X and 2), the prices net of the tax. A match blocked, or a
// market without one price per outcome, leaves the match out.
export function parseVbetGames(reply: VbetReply, alias: string, now = Date.now()): RawEvent[] {
  const config = VBET_SPORTS[alias];
  if (!config) return [];
  const events: RawEvent[] = [];
  for (const sport of Object.values(reply.data?.sport ?? {})) {
    if (sport.alias !== alias) continue;
    for (const region of Object.values(sport.region ?? {})) {
      for (const comp of Object.values(region.competition ?? {})) {
        const competition = (comp.name ?? "").trim();
        for (const game of Object.values(comp.game ?? {})) {
          try {
            if (game.type === 1 || game.is_started || game.is_blocked) continue;
            if (typeof game.start_ts !== "number" || game.start_ts * 1000 <= now) continue;
            const [first, second] = [game.team1_name, game.team2_name].map((n) => nameOf(n ?? ""));
            if (!first || !second) continue;
            // The team named first is the home team, an American match's too.
            const [home, away] = [teamName(first, competition), teamName(second, competition)];
            const market = Object.values(game.market ?? {}).find((m) => m.type === config.market);
            const outcomes = Object.values(market?.event ?? {});
            if (!market || outcomes.length !== config.outcomes) continue;
            const names = [home, "Draw", away];
            const marketName = canonicalMarketName(config.outcomes);
            const seen = new Set<number>();
            const odds: RawOdds[] = outcomes
              .map((e) => {
                const side = SIDES[e.type ?? ""];
                if (side === undefined || seen.has(side)) throw new Error(`unexpected outcome "${e.type}"`);
                seen.add(side);
                const price = typeof e.price === "number" ? e.price : NaN;
                return { side, odds: { market: marketName, selection: names[side], price: netOfStakeTax(price, VBET_TAX) } };
              })
              .sort((a, b) => a.side - b.side)
              .map((o) => o.odds);
            if (seen.has(1) !== (config.outcomes === 3)) throw new Error("unexpected draw");
            const raw: RawEvent = {
              sport: config.sport,
              competition,
              startTime: new Date(game.start_ts * 1000).toISOString(),
              participants: [home, away],
              odds,
              sourceId: String(game.id),
            };
            const checked = validateRawEvent(raw, "vbet");
            if (checked) events.push(checked);
          } catch (err) {
            // One malformed match must not take down the rest of the list.
            console.warn(`[scraper:vbet] failed to read match ${game?.id}, skipping it:`, err);
          }
        }
      }
    }
  }
  return events;
}

// The socket the client talks through: the platform's WebSocket, or a test's.
export interface VbetSocket {
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(): void;
}
export type VbetSocketFactory = () => VbetSocket;

const platformSocket: VbetSocketFactory = () =>
  // Node's WebSocket takes an options object where the browser's takes the
  // protocols: the site's own origin, as its page sends it.
  new WebSocket(WS_URL, { headers: { Origin: ORIGIN } } as unknown as string[]) as unknown as VbetSocket;

// A session on the server: a command, and its answer's data.
export interface VbetSession {
  request<T>(command: string, params: Record<string, unknown>): Promise<T>;
  close(): void;
}

// Opens a session: the socket, then request_session for VBET.de's site, as
// the page does. Each command carries an id ("rid") its answer repeats; an
// answer with a "code" other than 0 is the command failing.
export async function openVbetSession(factory: VbetSocketFactory = platformSocket, timeoutMs = REQUEST_TIMEOUT_MS): Promise<VbetSession> {
  const socket = factory();
  const pending = new Map<string, { resolve: (data: unknown) => void; reject: (err: Error) => void }>();
  let nextId = 1;
  let gone: Error | null = null;
  const failAll = (err: Error) => {
    gone ??= err;
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };
  const opened = new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => {
      reject(new Error("vbet socket error"));
      failAll(new Error("vbet socket error"));
    };
    socket.onclose = () => {
      reject(new Error("vbet socket closed"));
      failAll(new Error("vbet socket closed"));
    };
  });
  // A socket failing once open is the pending commands failing, not this.
  opened.catch(() => {});
  socket.onmessage = (ev) => {
    let message: { rid?: string; code?: number; msg?: string; data?: unknown };
    try {
      message = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    const waiting = message.rid !== undefined ? pending.get(message.rid) : undefined;
    if (!waiting) return;
    pending.delete(message.rid!);
    if (message.code === 0) waiting.resolve(message.data);
    else waiting.reject(new Error(`vbet: code ${message.code} ${message.msg ?? ""}`.trim()));
  };
  const request = <T>(command: string, params: Record<string, unknown>): Promise<T> => {
    if (gone) return Promise.reject(gone);
    const rid = `${command}-${nextId++}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(rid);
        reject(new Error(`vbet ${command}: no answer`));
      }, timeoutMs);
      pending.set(rid, {
        resolve: (data) => {
          clearTimeout(timer);
          resolve(data as T);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      socket.send(JSON.stringify({ command, params, rid }));
    });
  };
  const close = () => {
    socket.onclose = null;
    socket.onerror = null;
    failAll(new Error("vbet session closed"));
    socket.close();
  };
  try {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      opened,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("vbet socket did not open")), timeoutMs);
      }),
    ]).finally(() => clearTimeout(timer));
    await request("request_session", { language: LANGUAGE, site_id: SITE_ID, source: SOURCE });
  } catch (err) {
    close();
    throw err;
  }
  return { request, close };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchVbet(opts: { connect?: () => Promise<VbetSession>; now?: () => number; delayMs?: number } = {}): Promise<RawEvent[]> {
  const session = await (opts.connect ?? (() => openVbetSession()))();
  const sports = Object.keys(VBET_SPORTS);
  const read = [];
  try {
    // One sport after the other, on the one session.
    for (const alias of sports) {
      read.push(
        await session
          .request<VbetReply>("get", vbetGamesQuery(alias))
          .then((reply) => ({ ok: true as const, value: parseVbetGames(reply, alias, (opts.now ?? Date.now)()) }), (reason) => ({ ok: false as const, reason }))
      );
      await sleep(opts.delayMs ?? REQUEST_DELAY_MS);
    }
  } finally {
    session.close();
  }
  // Every sport failing is the bookmaker failing (runScrapeCycle retries it);
  // one failing costs only its own matches.
  if (read.every((r) => !r.ok)) throw new Error("every vbet sport failed");
  return read.flatMap((r, i) => {
    if (!r.ok) {
      console.warn(`[scraper:vbet] sport ${sports[i]} failed, skipping it:`, r.reason);
      return [];
    }
    return r.value;
  });
}

export const vbetScraper: BookmakerScraper = { id: "vbet", fetch: () => fetchVbet() };
