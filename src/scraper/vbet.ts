import { RawEvent, RawOdds } from "../types";
import { BookmakerScraper } from "./run";
import { BookmakerId, canonicalMarketName, canonicalSport, COMPETITION_WINNER_SPORTS, MARKET_OUTRIGHT, verifiedSportNames } from "./canonical";
import { golfBestOf, marketKey } from "../markets/catalog";
import { validateRawEvent } from "./validateRawEvent";
import {
  MARKET_KINDS,
  readAmericanFootballMarkets,
  readBasketballMarkets,
  readHandballMarkets,
  readIceHockeyMarkets,
  readRugbyUnionMarkets,
  readSoccerMarkets,
  readTennisMarkets,
} from "./vbetMarkets";

// Vbet France's prices, from the websocket its site reads them from:
// BetConstruct's "Swarm" JSON protocol (wss://swarm-2.vbet.fr/, captured
// 5/10/2026, tests/scraper/fixtures/vbet-*.json.gz). One session, then one
// "get" per sport for its matches not started yet and their main market.
// Neither an account nor a token: the site's own first message, minus its
// anti-fraud fields, opens it.
//
// Swarm is BetConstruct's server for all its partners, told apart by the site's
// id in the session request: CircusBet's and DAZN Bet's sites name the same
// server (`springParams.swarmUrl` of their pages, read 12/10/2026) and their
// partner id as the site id (`springConfig.partnerId`), with which an anonymous
// session opens and lists the same 96 sports. They are read the way Vbet is.

export interface SwarmSite {
  id: Extract<BookmakerId, "vbet" | "circusbet" | "daznbet">;
  // How its errors name it.
  name: string;
  url: string;
  siteId: string;
}

const SWARM_URL = "wss://swarm-2.vbet.fr/";
export const VBET: SwarmSite = { id: "vbet", name: "Vbet", url: SWARM_URL, siteId: "277" };
export const CIRCUSBET: SwarmSite = { id: "circusbet", name: "CircusBet", url: SWARM_URL, siteId: "1869622" };
export const DAZNBET: SwarmSite = { id: "daznbet", name: "DAZN Bet", url: SWARM_URL, siteId: "18766873" };
const sessionOf = (site: SwarmSite) => ({ language: "fra", site_id: site.siteId, source: 42 });
const OPEN_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 30_000;

// A sport's main market, by the market's Swarm kind: its result or winner,
// in order of preference. Only these: Vbet lists variants of the same type
// beside them ("Vainqueur du match (20 pts d'avance)", MatchWinner2EP, is a
// handicap), and a match without one of them is left out. Ice hockey's
// result in regular time first, like Winamax's and the exchange's 1X2; its
// winner overtime included when that is all Vbet offers.
const MAIN_MARKETS: Record<string, readonly string[]> = {
  Soccer: ["MatchResult"],
  IceHockey: ["MatchWinner3", "MatchWinner2"],
  Basketball: ["MatchWinner2"],
  Tennis: ["MatchResult"],
  Volleyball: ["MatchWinner2"],
  AmericanFootball: ["MatchWinner"],
  Baseball: ["MatchResult"],
  Handball: ["MatchWinner", "MatchWinner2"],
  RugbyUnion: ["MatchResult"],
  RugbyLeague: ["MatchResult", "MatchWinner"],
  Snooker: ["MatchResult"],
  Mma: ["MoneyLine"],
  Boxing: ["MoneyLine"],
  Badminton: ["MatchWinner"],
  TableTennis: ["MatchWinner"],
};

// A sport without head-to-heads (golf: a tournament's winner among its
// players) has no result to ask for: its games are tournaments, each with a
// "Winner" market of the Swarm kind of that name, and one outcome per player
// (6/10/2026, tests/scraper/fixtures/vbet-Golf.json.gz).
//
// Cycling, biathlon, Nascar (its races) and the F2 (AutoRacing) are read the same way:
// their games are dated as the other bookmakers' (a race's day, a season's
// start), and each pairs with theirs by its competitors. Formula 1, MotoGP
// ("Motorsport"), alpine and cross-country skiing are not, though Vbet lists
// them (8/10/2026): it dates a Grand Prix, its sprint and a season all at the
// weekend's start (9/10 at 8:30), a season of skiing at its first race, so the
// matcher paired the winner of a race with a qualifying's, a World Cup's
// overall winner with a giant slalom's.
const OUTRIGHT_MARKET_TYPES: Record<string, readonly string[]> = {
  Golf: ["Winner"],
  Cycling: ["Winner"],
  Biathlon: ["Winner"],
  Nascar: ["Winner"],
  AutoRacing: ["Winner"],
};

// The competitions of a sport's winners that are not read. Vbet lists the
// championship of each Nascar series (Cup, O'Reilly) in a competition of its
// own, beside the series' races: "Monster Energy NASCAR Cup - Compétition" for
// "Monster Energy NASCAR Cup Series", 16 contenders to the race's 39. It dates
// the championship at the weekend's start, as it does the race, and its
// contenders are all in the race's field, so the matcher (which has nothing but
// those to pair winner markets within 48 hours) could pair it with a race
// another bookmaker lists. Real case (13/10/2026): the Freeway Insurance 500
// showed Larson at 1.83 and Hamlin at 2.92 at Vbet, the championship's prices,
// for 7.70 and 6.50 on its site. Only the races are read.
const SKIPPED_OUTRIGHT_COMPETITIONS: Record<string, RegExp> = {
  Nascar: /comp[ée]tition/i,
};

// What a "get" of the betting source answers: sport > region > competition >
// game > market > event, each keyed by its id.
export interface VbetEvent {
  id: number;
  name: string;
  price: number;
  // "W1", "X", "W2"; "Over", "Home", "Yes"...
  type_1: string;
  // The outcome's line, when the market has one: "Home -1.5" has -1.5 (the
  // market's own is the unsigned 1.5).
  base?: number;
}
export interface VbetMarket {
  id: number;
  name: string;
  type: string;
  market_type: string;
  base?: number;
  event?: Record<string, VbetEvent>;
}
export interface VbetGame {
  id: number;
  team1_name?: string;
  team2_name?: string;
  start_ts: number;
  type?: number;
  is_blocked?: number;
  is_started?: number;
  market?: Record<string, VbetMarket>;
}
export interface VbetReply {
  code: number;
  data?: {
    data?: {
      sport?: Record<
        string,
        {
          alias: string;
          region?: Record<string, { competition?: Record<string, { name: string; game?: Record<string, VbetGame> }> }>;
        }
      >;
    };
  };
}

// A competition's winner (Ligue 1, Roland-Garros, the NBA) is a game with a first
// team only, titled with the competition and its season, and a "Winner" market of
// one outcome per contender (14/10/2026, tests/scraper/fixtures/vbet-competition-
// winners.json.gz: 52 in football, 9 in tennis, 9 in basketball). It is asked with
// the matches' markets, one request a sport, and read beside them.
const COMPETITION_MARKET_TYPES: readonly string[] = ["Winner"];

// The request for a sport's matches not started yet (Swarm's game types 0
// and 2, as the site asks) and their main market, either way round (P1XP2,
// 3 outcomes, or P1P2, 2), and the winners of its competitions. Every level of the tree is asked for, region
// included: without it, Swarm answers no game at all (5/10/2026, the first
// production cycles read nothing).
const WHAT = {
  sport: ["id", "alias"],
  region: ["id"],
  competition: ["id", "name"],
  game: [["id", "team1_name", "team2_name", "start_ts", "type", "is_blocked", "is_started"]],
  market: ["id", "name", "type", "market_type"],
  event: ["id", "name", "price", "type_1"],
};

export function sportRequest(alias: string): Record<string, unknown> {
  return {
    source: "betting",
    what: WHAT,
    where: {
      sport: { alias },
      game: { type: { "@in": [0, 2] } },
      market: { type: { "@in": OUTRIGHT_MARKET_TYPES[alias] ?? ["P1XP2", "P1P2", ...COMPETITION_MARKET_TYPES] } },
    },
    subscribe: false,
  };
}

// What the markets' request asks for: the same tree, and the lines (`base`) of
// the markets and of their outcomes.
const MARKETS_WHAT = {
  ...WHAT,
  market: [...WHAT.market, "base"],
  event: [...WHAT.event, "base"],
};

// The markets of given games: a golf tournament's Top 5, 10 and 20, its round
// leaders, its forecasts (6/10/2026, tests/scraper/fixtures/vbet-GolfMarkets.
// json.gz), whatever their kind, which a tournament has a dozen of; a football
// or a tennis match has some 240 and 50, of which `kinds` are asked for.
export function gamesRequest(gameIds: readonly number[], kinds?: readonly string[]): Record<string, unknown> {
  return {
    source: "betting",
    what: MARKETS_WHAT,
    where: {
      game: { id: { "@in": [...gameIds] } },
      ...(kinds ? { market: { market_type: { "@in": [...kinds] } } } : {}),
    },
    subscribe: false,
  };
}

// The sport of given games, nothing else: which markets to ask for each.
export function sportsRequest(gameIds: readonly number[]): Record<string, unknown> {
  return {
    source: "betting",
    what: { sport: ["id", "alias"], region: ["id"], competition: ["id"], game: [["id"]] },
    where: { game: { id: { "@in": [...gameIds] } } },
    subscribe: false,
  };
}

// The games of a reply, each with its sport's alias.
function gamesOf(reply: VbetReply): Array<{ alias: string; game: VbetGame }> {
  return Object.values(reply.data?.data?.sport ?? {}).flatMap((sportData) =>
    Object.values(sportData.region ?? {}).flatMap((region) =>
      Object.values(region.competition ?? {}).flatMap((competition) =>
        Object.values(competition.game ?? {}).map((game) => ({ alias: sportData.alias, game }))
      )
    )
  );
}

// A tournament's market by Swarm's kind: "Top10Finish", "1stRoundLeader". The
// winner is the listing's own; the forecasts ("StraightForecast") are other bets.
function golfMarketOf(kind: string): string | undefined {
  const top = /^Top(\d+)Finish$/.exec(kind);
  if (top) return marketKey("golf_top", Number(top[1]));
  const round = /^(\d)(?:st|nd|rd|th)RoundLeader$/.exec(kind);
  return round ? marketKey("golf_round_leader", Number(round[1])) : undefined;
}

// A golf tournament's markets: its Top N and round leaders as the catalog's.
function readGolfMarkets(markets: readonly VbetMarket[]): RawOdds[] {
  return markets.flatMap((market) => {
    // The best of a nationality has no kind of its own to know: its title says it ("Meilleur
    // Européen"), as it does at the others. None was on Vbet's Open d'Espagne (6/10/2026)
    // when Winamax, Betclic and Unibet had eleven, so this reads what appears.
    const key = golfMarketOf(market.market_type) ?? golfBestOf(market.name);
    return key
      ? Object.values(market.event ?? {})
          .filter((o) => o.price > 1)
          .map((o): RawOdds => ({ market: key, selection: o.name.trim(), price: o.price }))
      : [];
  });
}

// A sport's way of reading its games' markets, by its Swarm alias. A sport that is
// not here is read as a golf tournament's.
const READERS: Record<string, (markets: readonly VbetMarket[]) => RawOdds[]> = {
  Soccer: readSoccerMarkets,
  Tennis: readTennisMarkets,
  Basketball: readBasketballMarkets,
  IceHockey: readIceHockeyMarkets,
  AmericanFootball: readAmericanFootballMarkets,
  Handball: readHandballMarkets,
  RugbyUnion: readRugbyUnionMarkets,
};

// The markets of the games of a reply to gamesRequest, by game id, each read
// as its sport's: a match's every market a family covers (./vbetMarkets.ts), a
// golf tournament's Top N and round leaders. A game without any is there all the
// same, empty.
export function readVbetMarkets(reply: VbetReply): Map<string, RawOdds[]> {
  const byGame = new Map<string, RawOdds[]>();
  for (const { alias, game } of gamesOf(reply)) {
    const markets = Object.values(game.market ?? {});
    byGame.set(String(game.id), (READERS[alias] ?? readGolfMarkets)(markets));
  }
  return byGame;
}

const SELECTION_ORDER = ["W1", "X", "W2"];

// A sport's matches as raw events: two teams, a start, their main market's
// prices labelled with the teams' names and "Nul" (the matcher reads them
// as 1, X and 2, src/matcher/match.ts).
export function readVbetSport(reply: VbetReply, alias: string, site: SwarmSite = VBET): RawEvent[] {
  const preferred = MAIN_MARKETS[alias] ?? [];
  const tournamentMarkets = OUTRIGHT_MARKET_TYPES[alias];
  const skippedCompetitions = SKIPPED_OUTRIGHT_COMPETITIONS[alias];
  const events: RawEvent[] = [];
  for (const sportData of Object.values(reply.data?.data?.sport ?? {})) {
    const sport = canonicalSport(site.id, sportData.alias);
    for (const region of Object.values(sportData.region ?? {})) {
      for (const competition of Object.values(region.competition ?? {})) {
        // A matchday's statistics ("Ligue 1 - Statistiques de la journée",
        // "UEFA Nations League. Matchday Statistics"): "1res équipes (Buts) -
        // 2es équipes (Buts)", not a match.
        if (/statisti/i.test(competition.name)) continue;
        if (skippedCompetitions?.test(competition.name)) continue;
        for (const game of Object.values(competition.game ?? {})) {
          try {
            // A game without a second team is a competition's winner (gameToRawEvent
            // leaves it out), in the sports with head-to-heads.
            const event = tournamentMarkets
              ? tournamentToRawEvent(game, sport, competition.name.trim(), tournamentMarkets)
              : !game.team2_name && COMPETITION_WINNER_SPORTS.has(sport)
                ? tournamentToRawEvent(game, sport, competition.name.trim(), COMPETITION_MARKET_TYPES)
                : gameToRawEvent(game, sport, competition.name.trim(), preferred);
            const checked = event && validateRawEvent(event, site.id);
            if (checked) events.push(checked);
          } catch (err) {
            console.warn(`[scraper:${site.id}] failed to read game ${game?.id}, skipping it:`, err);
          }
        }
      }
    }
  }
  return events;
}

// A tournament: its title (the game's only name) and its "Winner" market, one
// outcome per player. Vbet pads names with spaces ("Jorge Campillo  ", " Europe").
function tournamentToRawEvent(
  game: VbetGame,
  sport: string,
  competition: string,
  marketTypes: readonly string[]
): RawEvent | null {
  const title = game.team1_name?.trim();
  const market = Object.values(game.market ?? {}).find((m) => marketTypes.includes(m.type));
  if (!title || !market || game.is_started || game.is_blocked) return null;
  const odds: RawOdds[] = Object.values(market.event ?? {}).map((o) => ({
    market: MARKET_OUTRIGHT,
    selection: o.name.trim(),
    price: o.price,
  }));
  return {
    sport,
    competition,
    startTime: new Date(game.start_ts * 1000).toISOString(),
    participants: [title],
    odds,
    sourceId: String(game.id),
  };
}

function gameToRawEvent(
  game: VbetGame,
  sport: string,
  competition: string,
  preferred: readonly string[]
): RawEvent | null {
  const team1 = game.team1_name?.trim();
  const team2 = game.team2_name?.trim();
  // A competition's winner ("Tour de France 2027") is a game without a
  // second team; one under way or suspended is left out too.
  if (!team1 || !team2 || game.is_started || game.is_blocked) return null;
  const markets = Object.values(game.market ?? {});
  const market = preferred
    .map((kind) => markets.find((m) => m.market_type === kind))
    .find((m): m is VbetMarket => m !== undefined);
  if (!market) return null;
  const outcomes = Object.values(market.event ?? {}).sort(
    (a, b) => SELECTION_ORDER.indexOf(a.type_1) - SELECTION_ORDER.indexOf(b.type_1)
  );
  const expected = market.type === "P1XP2" ? ["W1", "X", "W2"] : ["W1", "W2"];
  if (outcomes.map((o) => o.type_1).join() !== expected.join()) return null;
  const marketName = canonicalMarketName(outcomes.length);
  const label: Record<string, string> = { W1: team1, X: "Nul", W2: team2 };
  const odds: RawOdds[] = outcomes.map((o) => ({ market: marketName, selection: label[o.type_1], price: o.price }));
  return {
    sport,
    competition,
    startTime: new Date(game.start_ts * 1000).toISOString(),
    participants: [team1, team2],
    odds,
    sourceId: String(game.id),
  };
}

// One Swarm connection: its requests and their answers, by request id.
async function openSwarm(site: SwarmSite): Promise<{
  send: (command: string, params: unknown) => Promise<VbetReply>;
  close: () => void;
}> {
  const ws = new WebSocket(site.url);
  const pending = new Map<string, { resolve: (r: VbetReply) => void; reject: (e: Error) => void }>();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${site.name}'s websocket did not open`)), OPEN_TIMEOUT_MS);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`${site.name}'s websocket failed to open`));
    };
  });
  ws.onmessage = (message) => {
    try {
      const reply = JSON.parse(String(message.data)) as VbetReply & { rid?: string };
      if (reply.rid) pending.get(reply.rid)?.resolve(reply);
    } catch {
      // Not a reply to a request (a push): nothing waits for it.
    }
  };
  ws.onclose = () => {
    for (const { reject } of pending.values()) reject(new Error(`${site.name}'s websocket closed`));
    pending.clear();
  };
  let next = 0;
  const send = (command: string, params: unknown) =>
    new Promise<VbetReply>((resolve, reject) => {
      const rid = `coteradar${++next}`;
      const timer = setTimeout(() => {
        pending.delete(rid);
        reject(new Error(`${site.name}'s ${command} timed out`));
      }, REQUEST_TIMEOUT_MS);
      pending.set(rid, {
        resolve: (reply) => {
          clearTimeout(timer);
          pending.delete(rid);
          resolve(reply);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      ws.send(JSON.stringify({ command, params, rid }));
    });
  return { send, close: () => ws.close() };
}

export async function fetchSwarm(site: SwarmSite): Promise<RawEvent[]> {
  const swarm = await openSwarm(site);
  try {
    const session = await swarm.send("request_session", sessionOf(site));
    if (session.code !== 0) throw new Error(`${site.name} refused the session (code ${session.code})`);
    const events: RawEvent[] = [];
    let failed = 0;
    const sports = verifiedSportNames("vbet").filter((alias) => MAIN_MARKETS[alias] || OUTRIGHT_MARKET_TYPES[alias]);
    for (const alias of sports) {
      try {
        const reply = await swarm.send("get", sportRequest(alias));
        if (reply.code !== 0) throw new Error(`code ${reply.code}`);
        events.push(...readVbetSport(reply, alias, site));
      } catch (err) {
        failed++;
        console.warn(`[scraper:${site.id}] "${alias}" failed, skipping it:`, err);
      }
    }
    // Every sport failing is the bookmaker failing (runScrapeCycle retries it).
    if (failed === sports.length) throw new Error(`every ${site.name} sport failed`);
    return events;
  } finally {
    swarm.close();
  }
}

export const fetchVbet = () => fetchSwarm(VBET);

// The sports whose matches' markets are asked for by kind (./vbetMarkets.ts),
// where a tournament's, which has a dozen, are all asked for (and a basketball
// match's).
const SPORTS_BY_KIND = new Set(["Soccer", "Tennis", "IceHockey", "AmericanFootball", "Handball", "RugbyUnion"]);

// The markets of the given games of a Swarm site, over one session: first their
// sports, then one request for the matches whose kinds are read (football, tennis,
// ice hockey, American football, handball, rugby union) and one for the others
// (every market: a tournament's, a basketball match's). A request Swarm refuses fails them all
// (the cycle logs it).
export const fetchSwarmMarkets =
  (site: SwarmSite) =>
  async (gameIds: readonly string[]): Promise<Map<string, RawOdds[]>> => {
    if (gameIds.length === 0) return new Map();
    const swarm = await openSwarm(site);
    try {
      const session = await swarm.send("request_session", sessionOf(site));
      if (session.code !== 0) throw new Error(`${site.name} refused the session (code ${session.code})`);
      const ask = async (request: Record<string, unknown>) => {
        const reply = await swarm.send("get", request);
        if (reply.code !== 0) throw new Error(`${site.name} refused the markets request (code ${reply.code})`);
        return reply;
      };
      const ids = gameIds.map(Number);
      const sportOf = new Map(gamesOf(await ask(sportsRequest(ids))).map(({ alias, game }) => [game.id, alias]));
      const byKind = ids.filter((id) => SPORTS_BY_KIND.has(sportOf.get(id) ?? ""));
      const markets = new Map<string, RawOdds[]>();
      for (const [group, kinds] of [
        [byKind, MARKET_KINDS],
        [ids.filter((id) => !byKind.includes(id)), undefined],
      ] as const) {
        if (group.length === 0) continue;
        for (const [id, odds] of readVbetMarkets(await ask(gamesRequest(group, kinds)))) markets.set(id, odds);
      }
      return markets;
    } finally {
      swarm.close();
    }
  };

export const fetchVbetMarkets = fetchSwarmMarkets(VBET);
export const fetchCircusbetMarkets = fetchSwarmMarkets(CIRCUSBET);
export const fetchDaznbetMarkets = fetchSwarmMarkets(DAZNBET);

export const vbetScraper: BookmakerScraper = { id: VBET.id, fetch: fetchVbet };
export const circusbetScraper: BookmakerScraper = { id: CIRCUSBET.id, fetch: () => fetchSwarm(CIRCUSBET) };
export const daznbetScraper: BookmakerScraper = { id: DAZNBET.id, fetch: () => fetchSwarm(DAZNBET) };
