import { coversEveryCase, ParsedMarketKey, winnersOf } from "../markets/catalog";
import { MARKET_1X2, MARKET_MATCH_WINNER, MARKET_OUTRIGHT } from "../scraper/canonical";

// A market's prices, by outcome then by bookmaker, and the TRJ of its best
// prices: shared by a match's page (./eventDetail.ts) and the surebets
// (./surebets.ts).

// Outcomes -> bookmaker -> price, for one market key.
export type Grid = Map<string, Map<string, number>>;

function isComplete(parsed: ParsedMarketKey): boolean {
  if (parsed.kind === "family") return parsed.family.complete;
  // The listing's main markets: a match result, a winner.
  return parsed.kind === "other";
}

// The outcomes of the listing's main markets: every case, and nothing else.
const MAIN_OUTCOMES: Record<string, readonly string[]> = {
  [MARKET_1X2]: ["1", "X", "2"],
  [MARKET_MATCH_WINNER]: ["1", "2"],
};

// Every bookmaker pricing the market prices each of its outcomes: they
// cover the same cases. Different outcome sets (Winamax's exact goals up to
// "9 or more", Betclic's to "6 or more") don't.
export function sameOutcomes(grid: Grid): boolean {
  const bookmakers = new Set([...grid.values()].flatMap((prices) => [...prices.keys()]));
  return [...grid.values()].every((prices) => [...bookmakers].every((b) => prices.has(b)));
}

// "Autre score" is every score a bookmaker doesn't list: two bookmakers' are
// the same bet only when they list the same scores.
export const isRemainder = (outcome: string) => /^other(@[12])?$/.test(outcome);

// The best prices of a market whose outcomes cover every case add up to a
// TRJ. A bookmaker may price only some of them (Betclic only "over" its aces
// lines, Winamax both): "over 9.5 aces" is the same bet at both. Not with a
// remainder, which then holds other scores at each: there each bookmaker
// must price the same outcomes. (Overlapping ones, "2+" here and "3+" there,
// don't cover every case: coversEveryCase.) A main market's outcomes must be its 3 (a 1X2's) or 2
// (a winner's): a suspended draw, or a label left as the bookmaker wrote it,
// covers less.
export function payoutRateOf(parsed: ParsedMarketKey, grid: Grid): number | null {
  // A golf tournament's winner, its Top N and the leader of a round: N of the
  // players win (src/markets/catalog.ts, winnersOf).
  if (parsed.kind === "other" && parsed.name === MARKET_OUTRIGHT) return outrightRateOf(grid);
  const winners = winnersOf(parsed);
  if (winners !== undefined) return outrightRateOf(grid, winners);
  if (!isComplete(parsed) || grid.size < 2) return null;
  if (!sameOutcomes(grid) && [...grid.keys()].some(isRemainder)) return null;
  if (parsed.kind === "family" && !coversEveryCase(parsed.family.key, grid.keys())) return null;
  if (parsed.kind === "other") {
    const outcomes = MAIN_OUTCOMES[parsed.name];
    if (outcomes && (grid.size !== outcomes.length || !outcomes.every((o) => grid.has(o)))) return null;
  }

  const sum = [...grid.values()].reduce((s, prices) => s + 1 / Math.max(...prices.values()), 0);
  return 1 / sum;
}

// A winner-among-N market's (a race, a golf tournament): 1 / the sum of 1/best
// price over every competitor any bookmaker lists. Only when one of them lists
// the whole field, which its own implied probabilities adding up to 100% or
// more shows: Betclic's listing only carries its 3 favourites, and a rate
// over 3 runners (around 200%) would mean nothing. With several winners (a
// golf Top 5) the chances of the field add up to that many: the rate is
// `winners` / the sum, and the whole field adds up to `winners` or more.
export function outrightRateOf(grid: Grid, winners = 1): number | null {
  const bookmakers = new Set([...grid.values()].flatMap((prices) => [...prices.keys()]));
  const wholeField = [...bookmakers].some(
    (b) => [...grid.values()].reduce((sum, prices) => sum + (prices.has(b) ? 1 / prices.get(b)! : 0), 0) >= winners
  );
  if (!wholeField || grid.size < 2) return null;
  return winners / [...grid.values()].reduce((sum, prices) => sum + 1 / Math.max(...prices.values()), 0);
}

// A match's main market ("Vainqueur du match"): its outcomes are teams or a draw.
export function mainOutcomeLabel(outcome: string, participants: readonly string[]): string {
  if (outcome === "1") return participants[0] ?? outcome;
  if (outcome === "2") return participants[1] ?? outcome;
  if (outcome === "X") return "Nul";
  return outcome;
}
