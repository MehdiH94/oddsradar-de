import { io, Socket } from "socket.io-client";
import { randomUUID } from "node:crypto";
import { RawEvent, RawOdds } from "../types";
import { BookmakerScraper } from "./run";
import { canonicalMarketName, canonicalSport, hasOutrights, isResultMarketTitle, MARKET_OUTRIGHT, OUTRIGHT_SPORTS } from "./canonical";
import { validateRawEvent } from "./validateRawEvent";

export interface WinamaxMatch {
  sportId: number;
  tournamentId: number;
  mainBetId: number;
  matchStart: number; // Unix timestamp, seconds
  // Typed as the head-to-head case, but NOT guaranteed at runtime: Winamax
  // models outright markets as matches with both names null (see
  // tests/scraper/fixtures/winamax-outright-snapshot.json). validateRawEvent
  // is what enforces two real names before an event leaves this scraper.
  competitor1Name: string;
  competitor2Name: string;
  // "Tour de France 2027 - Compétition": the only name an outright market has.
  title?: string;
}

export interface WinamaxBet {
  betTitle: string;
  outcomes: number[];
}

export interface WinamaxSnapshot {
  // A live "sport:<id>" response has sports[id] without a sportName and no
  // tournaments at all (verified against a live capture, 2026-09-27); only
  // page-state captures like the test fixtures carry both.
  sports: Record<string, { sportName?: string }>;
  tournaments: Record<string, { tournamentName: string }>;
  matches: Record<string, WinamaxMatch>;
  bets: Record<string, WinamaxBet>;
  outcomes: Record<string, { label: string }>;
  odds: Record<string, number>;
}

// Winamax's own sport catalog (tests/scraper/fixtures/winamax-sports-catalog.json),
// used because the live feed never sends sport names alongside matches.
const WINAMAX_SPORT_NAMES: Record<number, string> = {
  1: "Football",
  2: "Basketball",
  3: "Baseball",
  4: "Hockey sur glace",
  5: "Tennis",
  6: "Handball",
  9: "Golf",
  10: "Boxe",
  11: "Automobile",
  12: "Rugby à XV",
  13: "Football australien",
  16: "Football américain",
  17: "Cyclisme",
  19: "Snooker",
  // 20 (table tennis), 31 (badminton) and 79 (judo, its world championships'
  // winners) are in neither the catalog fixture nor the live "home"
  // (8/10/2026), but each answers its "sport:<id>" route.
  20: "Tennis de table",
  23: "Volley-ball",
  31: "Badminton",
  40: "Formule 1",
  43: "Ski alpin",
  44: "Biathlon",
  46: "Ski de fond",
  48: "Saut à ski",
  79: "Judo",
  117: "MMA",
  190: "Moto",
  9992: "Rugby à XIII",
};

const warnedUnknownSportIds = new Set<number>();

function sportNameFor(snapshot: WinamaxSnapshot, sportId: number): string | null {
  const name = snapshot.sports[sportId]?.sportName ?? WINAMAX_SPORT_NAMES[sportId];
  if (name !== undefined) return name;
  // Once per ID per process: the worker re-fetches every POLL_INTERVAL_MINUTES.
  if (!warnedUnknownSportIds.has(sportId)) {
    warnedUnknownSportIds.add(sportId);
    console.warn(`[scraper:winamax] no name for sportId ${sportId}, skipping its matches`);
  }
  return null;
}

const warnedOtherMainBets = new Set<string>();

// Once per sport and title per process: the worker re-fetches every
// POLL_INTERVAL_MINUTES.
function warnOtherMainBet(sport: string, title: string | undefined): void {
  const key = `${sport}|${title}`;
  if (warnedOtherMainBets.has(key)) return;
  warnedOtherMainBets.add(key);
  console.warn(`[scraper:winamax] a ${sport} match's main bet is "${title}", not its result or winner: skipping it`);
}

function matchToRawEvent(snapshot: WinamaxSnapshot, match: WinamaxMatch, matchId: string): RawEvent | null {
  const bet = snapshot.bets[match.mainBetId];
  if (!bet) return null;
  const sportName = sportNameFor(snapshot, match.sportId);
  if (sportName === null) return null;

  const sport = canonicalSport("winamax", sportName);
  // A winner-among-N market of a sport without head-to-heads (a race, a golf
  // tournament), or the winner of a competition of one with ("Championnat
  // d'Europe 2026", volleyball): no competitor names, its title stands for the
  // event and its runners are the selections. A competition's other bets (its
  // top scorer, its relegated) have the same shape: only a bet titled as its
  // winner is read. Anywhere else, such a market keeps its null names and
  // validateRawEvent drops it.
  const outright =
    match.competitor1Name == null &&
    match.competitor2Name == null &&
    bet.outcomes.length >= 3 &&
    hasOutrights(sport) &&
    (OUTRIGHT_SPORTS.has(sport) || isResultMarketTitle(bet.betTitle ?? ""));
  // A match whose main bet is not its result or winner (a handicap, a goals
  // total) is left out rather than read as one. See ./canonical.ts.
  if (!outright && !isResultMarketTitle(bet.betTitle ?? "")) {
    warnOtherMainBet(sport, bet.betTitle);
    return null;
  }
  // The shared cross-bookmaker market key, derived from the bet's declared
  // outcome count -- not bet.betTitle ("Résultat"), which never equals
  // Betclic's name for the same market. See ./canonical.ts.
  const market = outright ? MARKET_OUTRIGHT : canonicalMarketName(bet.outcomes.length);
  const odds: RawOdds[] = bet.outcomes
    .map((outcomeId): RawOdds | null => {
      const outcome = snapshot.outcomes[outcomeId];
      const price = snapshot.odds[outcomeId];
      if (!outcome || price === undefined) return null;
      return { market, selection: outcome.label, price };
    })
    .filter((o): o is RawOdds => o !== null);
  if (odds.length === 0) return null;

  return {
    sport,
    // Not in the live feed, and neither displayed nor used for matching: a
    // matched event takes Betclic's competition (Betclic seeds matchEvents).
    competition: snapshot.tournaments[match.tournamentId]?.tournamentName ?? "",
    startTime: new Date(match.matchStart * 1000).toISOString(),
    participants: outright ? [match.title ?? ""] : [match.competitor1Name, match.competitor2Name],
    odds,
    sourceId: matchId,
  };
}

export function snapshotToRawEvents(snapshot: WinamaxSnapshot): RawEvent[] {
  const events: RawEvent[] = [];

  for (const [matchId, match] of Object.entries(snapshot.matches)) {
    try {
      const candidate = matchToRawEvent(snapshot, match, matchId);
      if (!candidate) continue;
      // Last step before an event leaves this scraper: reject anything the
      // shared matcher/DB can't safely take (e.g. Winamax's outright markets,
      // which arrive as "matches" with null competitor names and many runners).
      const event = validateRawEvent(candidate, "winamax");
      if (event) events.push(event);
    } catch (err) {
      // A value that is present but malformed (an unparseable matchStart makes
      // toISOString() throw; a non-string sportName makes canonicalSport
      // throw) must cost only this match, not every other
      // match in the fetch -- same per-match isolation as parseBetclicFrame.
      console.warn(`[scraper:winamax] failed to map match ${matchId}, skipping it:`, err);
    }
  }

  return events;
}

const WINAMAX_WS_URL = "https://sports-eu-west-3.winamax.fr";
const SOCKET_PATH = "/uof-sports-server/socket.io";
const ROUTE_TIMEOUT_MS = 15000;

function emptySnapshot(): WinamaxSnapshot {
  return { sports: {}, tournaments: {}, matches: {}, bets: {}, outcomes: {}, odds: {} };
}

function mergeSnapshot(target: WinamaxSnapshot, incoming: Partial<WinamaxSnapshot>): void {
  for (const key of ["sports", "tournaments", "matches", "bets", "outcomes", "odds"] as const) {
    const value = incoming[key];
    if (value) Object.assign(target[key], value);
  }
}

// The server echoes back whatever requestId was sent on the matching "m"
// response (verified live), which is how a specific request is distinguished
// from an unrelated live-odds delta that might arrive between requests.
function requestRoute(socket: Socket, route: string): Promise<Record<string, unknown>> {
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("m", onMessage);
      reject(new Error(`Winamax route "${route}" timed out`));
    }, ROUTE_TIMEOUT_MS);

    function onMessage(data: Record<string, unknown>) {
      if (data.requestId !== requestId) return;
      clearTimeout(timeout);
      socket.off("m", onMessage);
      resolve(data);
    }

    socket.on("m", onMessage);
    socket.emit("m", { route, requestId });
  });
}

export async function fetchWinamaxSnapshot(): Promise<WinamaxSnapshot> {
  const snapshot = emptySnapshot();

  const socket = io(WINAMAX_WS_URL, {
    path: SOCKET_PATH,
    query: { language: "FR", version: "3.65.0", embed: "false" },
    transports: ["websocket"],
    timeout: ROUTE_TIMEOUT_MS,
  });

  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", (err: Error) => reject(err));
    });

    const home = await requestRoute(socket, "home");
    mergeSnapshot(snapshot, home as Partial<WinamaxSnapshot>);

    // The live "home" response carries no sport list (verified 2026-09-27;
    // only page-state captures had `sportIds`), so the known catalog is
    // always queried, plus any IDs home does advertise.
    const advertised = (home.sportIds as number[] | undefined) ?? [];
    const sportIds = new Set([...advertised, ...Object.keys(WINAMAX_SPORT_NAMES).map(Number)]);
    for (const sportId of sportIds) {
      try {
        const page = await requestRoute(socket, `sport:${sportId}`);
        mergeSnapshot(snapshot, page as Partial<WinamaxSnapshot>);
      } catch (err) {
        // One sport failing to respond in time must not drop every other
        // sport's odds -- mirrors Betclic's per-sport isolation (Task 2).
        console.warn(`[scraper:winamax] fetch failed for sportId ${sportId}:`, err);
      }
    }
  } finally {
    socket.close();
  }

  return snapshot;
}

export const winamaxScraper: BookmakerScraper = {
  id: "winamax",
  fetch: async () => snapshotToRawEvents(await fetchWinamaxSnapshot()),
};
