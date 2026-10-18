import { RawEvent, RawOdds } from "../types";
import { BookmakerScraper } from "./run";
import { canonicalMarketName, canonicalSport } from "./canonical";
import { netOfStakeTax } from "./stakeTax";
import { teamName } from "./twentybet";
import { validateRawEvent } from "./validateRawEvent";

// bet-at-home.de's prices, from the sports API its site reads them from
// (EveryMatrix's, wss://sportsapi.bet-at-home.de/v2, seen in its pages'
// requests, 18/10/2026, tests/scraper/fixtures/betathome-*.json): WAMP over a
// WebSocket, without an account, a cookie or a token. Its site has no
// challenge in front of it, unlike bwin's, Interwetten's and Betano's
// (Cloudflare's, 18/10/2026), which are not read.
//
// A sport's matches before kick-off with their main market, a time window
// after the other: the API answers 200 matches at most, a window that reaches
// it is read again in halves.

const API = "wss://sportsapi.bet-at-home.de/v2";
// The site's realm, operator and language: the names in English, the
// exchange's and the other bookmakers' (src/matcher/).
const REALM = "www.bet-at-home.de";
const OPERATOR = 2687;
const LANGUAGE = "en";

// The German betting tax, 5.3%: bet-at-home.de says it takes it off the
// winnings ("Win tax" / "winning deduction", both "Wettsteuer" in its site's
// own translations, 18/10/2026), the reviews disagree on how. Taken off the
// whole price, the most it can be: a price never shows more than it pays.
export const BETATHOME_TAX = 0.053;

// The API's most matches an answer, and the matches read: those starting
// within LOOKAHEAD_DAYS, a window halved down to MIN_WINDOW_S when it is full.
const MAX_MATCHES = 200;
const LOOKAHEAD_DAYS = 14;
const MIN_WINDOW_S = 15 * 60;
const REQUEST_DELAY_MS = 300;
// A stalled answer must fail rather than hang: the worker's overlap guard
// would otherwise skip every later cycle, for every bookmaker.
const REQUEST_TIMEOUT_MS = 20_000;

// The sports read, by the API's sport id: its main market's group (the site's
// own, its "marketGroupsOverview", 18/10/2026) and its outcomes. A group of
// 1, X and 2 is the result in ordinary time ("1X2, Ordinary Time": the
// project's 1X2), one of 1 and 2 the winner ("Match bet, Whole Match",
// overtime included). Verified on the matches of that night, but darts'
// (none that night: its group from the site's list).
export const BETATHOME_SPORTS: Readonly<Record<string, { group: string; outcomes: 2 | 3 }>> = {
  "1": { group: "2721", outcomes: 3 },
  "3": { group: "1270", outcomes: 2 },
  "8": { group: "2390", outcomes: 2 },
  "7": { group: "2544", outcomes: 3 },
  "5": { group: "1084", outcomes: 2 },
  "6": { group: "2644", outcomes: 3 },
  "39": { group: "138", outcomes: 3 },
  "28": { group: "131", outcomes: 3 },
  "20": { group: "1440", outcomes: 2 },
  "45": { group: "2739", outcomes: 2 },
};

// The records of an answer, by their "_type" (the others are left out).
export interface BahRecord {
  _type?: string;
  id?: string;
  // A MATCH's.
  sportId?: string;
  statusId?: string;
  startTime?: number;
  parentName?: string;
  homeParticipantName?: string;
  awayParticipantName?: string;
  // A MARKET's: its match, its groups.
  eventId?: string;
  groupIds?: string[];
  numberOfOutcomes?: number;
  // A MARKET_OUTCOME_RELATION's.
  marketId?: string;
  outcomeId?: string;
  // An OUTCOME's side: "home", "draw" or "away".
  headerNameKey?: string;
  // A BETTING_OFFER's.
  odds?: number | null;
  isAvailable?: boolean;
  isLive?: boolean;
}
export interface BahDump {
  records?: BahRecord[] | null;
}

// The pre-match matches of a time window, with one market group's markets
// (the API's own topic, as the site asks it).
export const betathomeTopic = (sportId: string, group: string, from: number, to: number): string =>
  `/sports/${OPERATOR}/${LANGUAGE}/next-matches-aggregator-groups-overview-top-bets-by-dates/${sportId}/${from}-${to}/NOT_LIVE/500/${group}`;

// A competition's name without its season ("Bundesliga 2026/2027", "WNBA
// Including Playoffs 2026").
const competitionOf = (name: string | undefined): string => (name ?? "").replace(/\s+\d{4}(\/\d{2,4})?$/, "").trim();

// The matches of a sport's answer as raw events: each match not yet started
// with its main market, labelled with the teams' names and "Draw" (the matcher
// reads them as 1, X and 2), the prices net of the tax. A market without one
// available price per outcome leaves the match out.
export function parseBetathomeMatches(dump: BahDump, sportId: string): RawEvent[] {
  const config = BETATHOME_SPORTS[sportId];
  if (!config) return [];
  const byType = new Map<string, BahRecord[]>();
  for (const r of dump.records ?? []) byType.set(r._type ?? "", [...(byType.get(r._type ?? "") ?? []), r]);
  const of = (type: string) => byType.get(type) ?? [];
  const outcomesOf = new Map<string, string[]>();
  for (const r of of("MARKET_OUTCOME_RELATION")) {
    if (r.marketId && r.outcomeId) outcomesOf.set(r.marketId, [...(outcomesOf.get(r.marketId) ?? []), r.outcomeId]);
  }
  const outcome = new Map(of("OUTCOME").map((o) => [o.id, o]));
  const offer = new Map(of("BETTING_OFFER").map((b) => [b.outcomeId, b]));
  const marketOf = new Map(
    of("MARKET")
      .filter((m) => m.groupIds?.includes(config.group) && m.numberOfOutcomes === config.outcomes)
      .map((m) => [m.eventId, m])
  );

  const events: RawEvent[] = [];
  for (const match of of("MATCH")) {
    try {
      if (match.sportId !== sportId || match.statusId !== "1" || typeof match.startTime !== "number") continue;
      const competition = competitionOf(match.parentName);
      const [homeName, awayName] = [match.homeParticipantName?.trim(), match.awayParticipantName?.trim()];
      if (!homeName || !awayName) continue;
      // A women's or a youth team whose league alone says so (20bet's way too).
      const [home, away] = [teamName(homeName, competition), teamName(awayName, competition)];
      const market = marketOf.get(match.id);
      const ids = market?.id ? (outcomesOf.get(market.id) ?? []) : [];
      if (ids.length !== config.outcomes) continue;
      const names: Record<string, string> = { home, draw: "Draw", away };
      const marketName = canonicalMarketName(config.outcomes);
      const odds: RawOdds[] = ids.map((id) => {
        const side = outcome.get(id)?.headerNameKey ?? "";
        const selection = names[side];
        if (!selection || (side === "draw" && config.outcomes === 2)) throw new Error(`unexpected outcome "${side}"`);
        const o = offer.get(id);
        const price = o && o.isAvailable && !o.isLive && typeof o.odds === "number" ? o.odds : NaN;
        return { market: marketName, selection, price: netOfStakeTax(price, BETATHOME_TAX) };
      });
      const raw: RawEvent = {
        sport: canonicalSport("betathome", sportId),
        competition,
        startTime: new Date(match.startTime).toISOString(),
        participants: [home, away],
        odds,
        sourceId: String(match.id),
      };
      const checked = validateRawEvent(raw, "betathome");
      if (checked) events.push(checked);
    } catch (err) {
      // One malformed match must not take down the rest of the list.
      console.warn(`[scraper:betathome] failed to read match ${match?.id}, skipping it:`, err);
    }
  }
  return events;
}

// The socket the client talks through: the platform's WebSocket, or a test's.
export interface BahSocket {
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(): void;
}
export type BahSocketFactory = () => BahSocket;
const platformSocket: BahSocketFactory = () => new WebSocket(API, ["wamp.2.json"]) as unknown as BahSocket;

// WAMP's messages, as the site's client (Wampy.js) sends them: HELLO, then for
// each topic a REGISTER the server answers with REGISTERED, then the CALL of
// its initial dump, answered with a RESULT (or an ERROR).
const HELLO = 1;
const WELCOME = 2;
const ERROR = 8;
const CALL = 48;
const RESULT = 50;
const REGISTER = 64;
const REGISTERED = 65;

// One session: open, a dump per topic one after the other, close.
export class BetathomeSession {
  private socket: BahSocket;
  private nextId = 1;
  private pending = new Map<number, (msg: unknown[] | null) => void>();
  private ready: Promise<void>;

  constructor(factory: BahSocketFactory = platformSocket) {
    this.socket = factory();
    this.ready = new Promise((resolve, reject) => {
      this.socket.onopen = () => this.socket.send(JSON.stringify([HELLO, REALM, { roles: { caller: { features: {} } } }]));
      this.socket.onerror = () => {
        reject(new Error("bet-at-home socket error"));
        this.failAll();
      };
      this.socket.onclose = () => {
        reject(new Error("bet-at-home socket closed"));
        this.failAll();
      };
      this.socket.onmessage = (ev) => {
        let msg: unknown[];
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (msg[0] === WELCOME) resolve();
        else if (msg[0] === REGISTERED || msg[0] === RESULT || msg[0] === ERROR) {
          const id = Number(msg[0] === ERROR ? msg[2] : msg[1]);
          this.pending.get(id)?.(msg);
          this.pending.delete(id);
        }
      };
    });
  }

  private failAll(): void {
    for (const resolve of this.pending.values()) resolve(null);
    this.pending.clear();
  }

  private request(message: (id: number) => unknown[]): Promise<unknown[]> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("bet-at-home: no answer"));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        if (msg === null) reject(new Error("bet-at-home: socket gone"));
        else if (msg[0] === ERROR) reject(new Error(`bet-at-home: ${JSON.stringify(msg).slice(0, 200)}`));
        else resolve(msg);
      });
      this.socket.send(JSON.stringify(message(id)));
    });
  }

  async dump(topic: string): Promise<BahDump> {
    await this.ready;
    await this.request((id) => [REGISTER, id, {}, topic]);
    const result = await this.request((id) => [CALL, id, {}, "/sports#initialDump", [], { topic }]);
    return (result[4] ?? {}) as BahDump;
  }

  close(): void {
    this.socket.close();
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const matchesIn = (dump: BahDump) => (dump.records ?? []).filter((r) => r._type === "MATCH").length;

// A sport's matches of a window, read again in halves while an answer is full.
async function fetchWindow(session: BetathomeSession, sportId: string, from: number, to: number, delayMs: number): Promise<RawEvent[]> {
  const dump = await session.dump(betathomeTopic(sportId, BETATHOME_SPORTS[sportId].group, from, to));
  await sleep(delayMs);
  if (matchesIn(dump) >= MAX_MATCHES && to - from > MIN_WINDOW_S) {
    const middle = Math.floor((from + to) / 2);
    return [
      ...(await fetchWindow(session, sportId, from, middle, delayMs)),
      ...(await fetchWindow(session, sportId, middle + 1, to, delayMs)),
    ];
  }
  return parseBetathomeMatches(dump, sportId);
}

export async function fetchBetathome(
  opts: { socket?: BahSocketFactory; now?: () => number; delayMs?: number } = {}
): Promise<RawEvent[]> {
  const sports = Object.keys(BETATHOME_SPORTS);
  const from = Math.floor((opts.now ?? Date.now)() / 1000);
  const to = from + LOOKAHEAD_DAYS * 24 * 3600;
  const session = new BetathomeSession(opts.socket);
  const read = [];
  try {
    // One sport after the other, on one connection.
    for (const sportId of sports) {
      read.push(await fetchWindow(session, sportId, from, to, opts.delayMs ?? REQUEST_DELAY_MS).then((value) => ({ ok: true as const, value }), (reason) => ({ ok: false as const, reason })));
    }
  } finally {
    session.close();
  }
  // Every sport failing is the bookmaker failing (runScrapeCycle retries it);
  // one failing costs only its own matches.
  if (read.every((r) => !r.ok)) throw new Error("every betathome sport failed");
  const seen = new Set<string>();
  return read.flatMap((r, i) => {
    if (!r.ok) {
      console.warn(`[scraper:betathome] sport ${sports[i]} failed, skipping it:`, r.reason);
      return [];
    }
    // A match on the line between two windows comes in both.
    return r.value.filter((e) => !seen.has(e.sourceId ?? "") && seen.add(e.sourceId ?? ""));
  });
}

export const betathomeScraper: BookmakerScraper = { id: "betathome", fetch: fetchBetathome };
