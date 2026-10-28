import { EventWithOdds } from "../types";
import { Reference } from "./reference";
import { CONTROL_MIN_PAYOUT, controlPayout } from "../reference/pinnacleFair";

// A bookmaker's price against the reference's fair odds (src/db/reference.ts):
// its edge is how much more it pays than the outcome's real chances are worth,
// price / fair - 1. A value bet from 1% up: below, the reference's own
// uncertainty (a mid price between back and lay) is as large as the edge.
export const VALUE_MIN_EDGE = 0.01;

// A golf tournament's winner, whose players' prices are wider than a 1X2's
// (20% apart at most, for the fair odds to show): as for the players' markets
// (src/db/playerValue.ts), a value bet from 5%.
export const OUTRIGHT_VALUE_MIN_EDGE = 0.05;

export interface Value {
  edge: number;
  // "1", "X", "2".
  selection: string;
  bookmaker: string;
}

// The reference of a match's main market: the market it prices, its fair
// odds and, when they are Pinnacle's, Pinnacle's prices.
type MainReference = Pick<Reference, "market" | "fair" | "minEdge" | "sharp">;

// PasBet's second check of a value bet (pasbet.app/outils/fair-odds), when
// the fair odds are Pinnacle's: the bookmaker's price on the outcome with
// Pinnacle's on the others must make a market paying CONTROL_MIN_PAYOUT or
// more (src/reference/pinnacleFair.ts). Without Pinnacle's prices (the
// exchange's fair odds), every price passes.
export function passesControl(price: number, selection: string, sharp: Record<string, number> | undefined): boolean {
  if (!sharp || sharp[selection] === undefined) return true;
  const others = Object.entries(sharp).flatMap(([outcome, odds]) => (outcome === selection ? [] : [odds]));
  return controlPayout(price, others) >= CONTROL_MIN_PAYOUT - 1e-9;
}

// A match's main-market prices among the given bookmakers, against the
// reference's fair odds of each outcome: only those of the market it prices,
// so that a winner's 2 prices (overtime included) never meet a 1X2's fair
// odds (regular time), nor the other way round.
function mainPrices(event: EventWithOdds, { market, fair }: MainReference, bookmakers?: readonly string[]) {
  return Object.entries(event.byBookmaker).flatMap(([bookmaker, { odds }]) =>
    bookmakers && !bookmakers.includes(bookmaker)
      ? []
      : odds.flatMap((o) =>
          o.market === market && fair[o.selection] !== undefined
            ? [{ bookmaker, selection: o.selection, price: o.price, edge: edgeOf(o.price, fair[o.selection]) }]
            : []
        )
  );
}

export const edgeOf = (price: number, fair: number) => price / fair - 1;

// A match's best edge over its main market (1X2, tennis winner), among the
// given bookmakers (all when omitted), value bet or not.
export function bestValue(event: EventWithOdds, reference: MainReference, bookmakers?: readonly string[]): Value | null {
  let best: Value | null = null;
  for (const { edge, selection, bookmaker } of mainPrices(event, reference, bookmakers)) {
    if (!best || edge > best.edge) best = { edge, selection, bookmaker };
  }
  return best;
}

// Every value bet on a match's main market among the given bookmakers (all
// when omitted): one per bookmaker's price at or above the threshold (the
// reference's own, a golf winner's, or VALUE_MIN_EDGE) that passes the
// control against Pinnacle's prices when they are the source, the biggest
// edge first.
export function valueBetsOf(
  event: EventWithOdds,
  reference: MainReference,
  bookmakers?: readonly string[]
): (Value & { price: number })[] {
  return mainPrices(event, reference, bookmakers)
    .filter((p) => p.edge >= (reference.minEdge ?? VALUE_MIN_EDGE) && passesControl(p.price, p.selection, reference.sharp))
    .sort((a, b) => b.edge - a.edge);
}

// An outcome's value bets: the edge of each bookmaker's price at or above the
// threshold, and passing the control against Pinnacle's prices when they are
// the reference's (`control`: the outcome and Pinnacle's prices).
export function valueEdges(
  prices: Record<string, number>,
  fair: number,
  control?: { selection: string; sharp?: Record<string, number> }
): Record<string, number> {
  const edges: Record<string, number> = {};
  for (const [bookmaker, price] of Object.entries(prices)) {
    const edge = edgeOf(price, fair);
    if (edge >= VALUE_MIN_EDGE && (!control || passesControl(price, control.selection, control.sharp))) edges[bookmaker] = edge;
  }
  return edges;
}
