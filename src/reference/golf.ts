import { alignCompetitors, eventSimilarity, NAME_SIMILARITY_THRESHOLD } from "../matcher/match";
import { MARKET_OUTRIGHT } from "../scraper/canonical";
import { RawEvent } from "../types";
import { MarketPrices, midPrice, playerReliability } from "./exchange";
import { ReferenceMarketRow } from "./sports";

// The reference for a golf tournament's winner: the exchange lists each
// tournament as an event with a "Winner" market of one runner per player,
// whose prices are as good a measure of the players' chances as a match's 1X2
// is of its outcomes' (6/10/2026: 30 to 110 thousand euros matched on the
// week's two tournaments, a tenth of that on the majors months away).

// Betfair's event type of golf.
const GOLF = "3";
const WINNER = "WINNER";

// A tournament on the exchange, as its search lists it.
export interface GolfTournament {
  eventId: string;
  // As the exchange names it: "PGA Baycurrent Classic 2026", "The Masters 2027".
  name: string;
  startTime: string;
  marketId: string;
  // Its players: selection id -> the exchange's name ("Xander Schauffele").
  runners: Record<number, string>;
}

// The tournaments of a search for "Golf" (./exchange.ts, searchEvents): the
// events with a winner market, not the match bets, 3 balls and specials listed
// beside them, nor one under way.
export function parseGolfSearch(body: unknown): GolfTournament[] {
  const content = (body as { content?: unknown })?.content;
  if (!Array.isArray(content)) return [];
  const tournaments: GolfTournament[] = [];
  for (const event of content) {
    if (event?.eventTypeId !== GOLF || event.inPlay || typeof event.id !== "string" || typeof event.name !== "string") continue;
    if (!Number.isFinite(event.openDate) || !Array.isArray(event.topMarkets)) continue;
    const market = event.topMarkets.find((m: { description?: { marketType?: unknown } }) => m?.description?.marketType === WINNER);
    if (typeof market?.marketId !== "string" || !Array.isArray(market.runners)) continue;
    const runners: Record<number, string> = {};
    for (const r of market.runners as { selectionId?: unknown; runnerName?: unknown }[]) {
      if (typeof r.selectionId === "number" && typeof r.runnerName === "string") runners[r.selectionId] = r.runnerName.trim();
    }
    if (Object.keys(runners).length < 2) continue;
    tournaments.push({
      eventId: event.id,
      name: event.name.trim(),
      startTime: new Date(event.openDate).toISOString(),
      marketId: market.marketId,
      runners,
    });
  }
  return tournaments;
}

// One of our tournaments, as the exchange's is looked for.
export interface GolfTarget {
  participants: string[];
  startTime: string;
  // Its players as the bookmakers name them, those of the seed bookmaker first.
  competitors: string[];
  // Our sport key, golf unless it is another winner-among-N event paired the
  // same way (src/reference/f1.ts).
  sport?: string;
}

const asEvent = (title: string, startTime: string, players: readonly string[], sport = "golf"): RawEvent => ({
  sport,
  competition: "",
  startTime,
  participants: [title],
  odds: players.map((selection) => ({ market: MARKET_OUTRIGHT, selection, price: 2 })),
});

// The exchange's tournament for ours, the way the bookmakers' are paired
// (src/matcher/match.ts): its title and date, and above all its players. The
// exchange dates a tournament by its first round, the bookmakers up to a week
// later, and writes "DPW Tour Open de Espana 2026" for the Open d'Espagne.
export function placeGolfTournament(target: GolfTarget, tournaments: readonly GolfTournament[]): GolfTournament | null {
  const sport = target.sport ?? "golf";
  const ours = asEvent(target.participants[0], target.startTime, target.competitors, sport);
  let best: { tournament: GolfTournament; score: number } | null = null;
  for (const tournament of tournaments) {
    const score = eventSimilarity(ours, asEvent(tournament.name, tournament.startTime, Object.values(tournament.runners), sport));
    if (score >= NAME_SIMILARITY_THRESHOLD && (!best || score > best.score)) best = { tournament, score };
  }
  return best?.tournament ?? null;
}

// A tournament's winner prices on the exchange, under our spelling of each
// player (the players the bookmakers price: the others are of no use), with
// the fair odds of those whose back and lay are close enough to tell what
// they are worth: the mid price between them, its 20% and 20 euros of a
// players' market (./exchange.ts, playerReliability), with the chances of
// the field added up to 100% when its mid prices make more of it. A thin
// market has few of them, or none.
export function golfPrices(
  tournament: GolfTournament,
  ours: readonly string[],
  market: MarketPrices | undefined
): ReferenceMarketRow[] {
  if (!market) return [];
  const names = alignCompetitors(Object.values(tournament.runners), [...ours]);
  const mids = Object.keys(tournament.runners).map((id) => {
    const prices = market.runners.get(Number(id));
    return prices ? midPrice(prices) : undefined;
  });
  // Only the players priced on both sides add to the total: never scaled down
  // for those the exchange has no price for, whose chances it does not say.
  const chances = mids.reduce<number>((sum, mid) => (mid === undefined ? sum : sum + 1 / mid), 0);
  const scale = Math.max(chances, 1);
  return Object.entries(tournament.runners).flatMap(([id, name]) => {
    const player = names.get(name);
    const prices = market.runners.get(Number(id));
    if (!player || !prices || (prices.back === undefined && prices.lay === undefined)) return [];
    const mid = midPrice(prices);
    return [
      {
        market: MARKET_OUTRIGHT,
        selection: player,
        ...prices,
        ...(mid !== undefined && playerReliability(prices).shown ? { fair: mid * scale } : {}),
        matched: market.matched,
      },
    ];
  });
}
