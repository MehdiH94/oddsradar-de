import { normalizeName } from "../matcher/normalize";
import { MARKET_1X2, MARKET_MATCH_WINNER } from "../scraper/canonical";
import { fairOddsOf, MarketPrices, RunnerPrices } from "./exchange";
import { placeOnExchange, ReferenceTarget } from "./match";
import { samePlayer } from "./tennis";

// The reference for the other head-to-head sports (src/reference/sportsRun.ts):
// the exchange's market matching the bookmakers' main one, under the same
// rule. Checked live on 4/10/2026 (tests/reference/fixtures/exchange-sports-*):
// - basketball, baseball, American football: "Moneyline", 2 outcomes,
//   overtime and extra innings included, like the bookmakers' winner;
// - ice hockey: "60 Minute 3 Way Match Odds" (draw "Tie"), the bookmakers'
//   1X2 being on regular time too;
// - rugby union: "Match Odds", 3 outcomes (draw "Draw");
// - MMA: "Fight Result", 2 outcomes.
// Left out: boxing (the exchange's has a draw, the bookmakers' winner none),
// handball and rugby league (not found on the exchange), the races but
// Formula 1's (too little money on their winners; ./f1.ts).

export interface ExchangeSport {
  eventTypeId: string;
  marketType: string;
  // Our key of the market: a 1X2's 3 outcomes, a winner's 2.
  market: typeof MARKET_1X2 | typeof MARKET_MATCH_WINNER;
  // How a match is found: by the matcher's similarity of its teams, or also
  // by its fighters' names ("M Dvalishvili").
  names: "teams" | "players";
}

// By our sport key (src/scraper/canonical.ts).
export const EXCHANGE_SPORTS: Readonly<Record<string, ExchangeSport>> = {
  basketball: {
    eventTypeId: "7522",
    marketType: "MATCH_ODDS",
    market: MARKET_MATCH_WINNER,
    names: "teams",
  },
  baseball: {
    eventTypeId: "7511",
    marketType: "MATCH_ODDS",
    market: MARKET_MATCH_WINNER,
    names: "teams",
  },
  "football américain": {
    eventTypeId: "6423",
    marketType: "MATCH_ODDS",
    market: MARKET_MATCH_WINNER,
    names: "teams",
  },
  "hockey sur glace": {
    eventTypeId: "7524",
    marketType: "RT_MATCH_ODDS",
    market: MARKET_1X2,
    names: "teams",
  },
  "rugby à xv": {
    eventTypeId: "5",
    marketType: "MATCH_ODDS",
    market: MARKET_1X2,
    names: "teams",
  },
  mma: {
    eventTypeId: "26420387",
    marketType: "MATCH_ODDS",
    market: MARKET_MATCH_WINNER,
    names: "players",
  },
};

export const REFERENCE_SPORTS = Object.keys(EXCHANGE_SPORTS);

export const outcomesOf = (sport: ExchangeSport): string[] =>
  sport.market === MARKET_1X2 ? ["1", "X", "2"] : ["1", "2"];

// One of the exchange's matches of a sport, with its main market's runners.
export interface SportEvent {
  eventId: string;
  // The home side first: "Home v Away", and the US "Away @ Home" turned round.
  participants: [string, string];
  startTime: string;
  marketId: string;
  runners: { home: number; away: number; draw?: number };
}

interface SearchRunner {
  selectionId?: unknown;
  runnerName?: unknown;
}

// The sport's matches in a search's answer (src/reference/exchange.ts,
// searchEvents) whose main market it lists with a runner for each side.
export function parseSportSearch(body: unknown, sport: ExchangeSport): SportEvent[] {
  const content = (body as { content?: unknown })?.content;
  if (!Array.isArray(content)) return [];
  const threeWay = sport.market === MARKET_1X2;
  return content.flatMap((event): SportEvent[] => {
    if (event?.eventTypeId !== sport.eventTypeId || event.inPlay || typeof event.id !== "string") return [];
    if (typeof event.name !== "string" || !Number.isFinite(event.openDate)) return [];
    const at = event.name.split(" @ ");
    const sides: string[] = (at.length === 2 ? [at[1], at[0]] : event.name.split(" v ")).map((p: string) => p.trim());
    if (sides.length !== 2 || sides.some((p) => !p)) return [];
    const market = Array.isArray(event.topMarkets)
      ? event.topMarkets.find(
          (m: { description?: { marketType?: unknown } }) => m?.description?.marketType === sport.marketType
        )
      : undefined;
    if (typeof market?.marketId !== "string" || !Array.isArray(market.runners)) return [];
    // As many runners as our outcomes: a winner's market with a draw would
    // not be the bookmakers' (a fight's draw voids their winner bets).
    const runners: SearchRunner[] = market.runners;
    if (runners.length !== (threeWay ? 3 : 2) || runners.some((r) => typeof r.selectionId !== "number")) return [];
    // Its runners are named like its sides, give or take the case ("BC Zalgiris
    // Kaunas" in the event, "Bc Zalgiris Kaunas" in the market); a 1X2's third
    // is the draw.
    const named = (side: string) => runners.find((r) => typeof r.runnerName === "string" && normalizeName(r.runnerName) === normalizeName(side));
    const home = named(sides[0]);
    const away = named(sides[1]);
    const draw = runners.find((r) => r !== home && r !== away);
    if (!home || !away || home === away) return [];
    return [
      {
        eventId: event.id,
        participants: [sides[0], sides[1]],
        startTime: new Date(event.openDate).toISOString(),
        marketId: market.marketId,
        runners: {
          home: home.selectionId as number,
          away: away.selectionId as number,
          ...(threeWay ? { draw: draw!.selectionId as number } : {}),
        },
      },
    ];
  });
}

// Fights are timed hours apart (the card's start, the bout's), like the
// matcher's tolerance for them.
const PLAYERS_START_TOLERANCE_MS = 12 * 60 * 60 * 1000;

// Our match among the exchange's, and the exchange's runner of each of our
// outcomes: "1" our first participant, whichever side the exchange lists
// them on.
export function placeSportEvent(
  sportKey: string,
  target: ReferenceTarget,
  candidates: readonly SportEvent[]
): { event: SportEvent; selections: Record<string, number> } | null {
  const sport = EXCHANGE_SPORTS[sportKey];
  if (!sport) return null;
  let placed = placeOnExchange(sportKey, target, candidates);
  if (!placed && sport.names === "players" && target.participants.length === 2) {
    const [one, two] = target.participants;
    for (const event of candidates) {
      if (Math.abs(Date.parse(event.startTime) - Date.parse(target.startTime)) > PLAYERS_START_TOLERANCE_MS) continue;
      const [home, away] = event.participants;
      if (samePlayer(one, home) && samePlayer(two, away)) placed = { match: event, homeFirst: true };
      else if (samePlayer(one, away) && samePlayer(two, home)) placed = { match: event, homeFirst: false };
      if (placed) break;
    }
  }
  if (!placed) return null;
  const { home, away, draw } = placed.match.runners;
  return {
    event: placed.match,
    selections: {
      "1": placed.homeFirst ? home : away,
      "2": placed.homeFirst ? away : home,
      ...(draw !== undefined ? { X: draw } : {}),
    },
  };
}

// One outcome's prices on the exchange, and its fair odds.
export interface ReferenceMarketRow extends RunnerPrices {
  market: string;
  selection: string;
  fair?: number;
  matched: number;
}

// A match's main-market prices, and the fair odds of all its outcomes when
// every one's are tight enough (a football 1X2's rule).
export function sportPrices(
  sport: ExchangeSport,
  selections: Readonly<Record<string, number>>,
  market: MarketPrices | undefined
): ReferenceMarketRow[] {
  if (!market) return [];
  const outcomes = outcomesOf(sport);
  const runners: Record<string, RunnerPrices | undefined> = Object.fromEntries(
    outcomes.map((o) => [o, selections[o] === undefined ? undefined : market.runners.get(selections[o])])
  );
  const fair = fairOddsOf(runners, outcomes);
  return outcomes.flatMap((o) => {
    const prices = runners[o];
    if (!prices || (prices.back === undefined && prices.lay === undefined)) return [];
    return [
      {
        market: sport.market,
        selection: o,
        ...prices,
        ...(fair ? { fair: fair[o] } : {}),
        matched: market.matched,
      },
    ];
  });
}
