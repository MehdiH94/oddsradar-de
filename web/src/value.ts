// A bookmaker's price against the reference's fair odds (src/db/value.ts on
// the API's side): its edge is price / fair - 1, a value bet from 1% up. From
// 5% up on the players' markets, whose exchange prices are looser
// (src/db/playerValue.ts).
export const VALUE_MIN_EDGE = 0.01;
export const PLAYER_VALUE_MIN_EDGE = 0.05;

// The edge of a price that is a value bet, else undefined: from VALUE_MIN_EDGE,
// or from the reference's own (`minEdge`, a golf winner's 5%).
export function valueEdge(
  price: number | undefined,
  fair: number | undefined,
  minEdge = VALUE_MIN_EDGE
): number | undefined {
  if (price === undefined || fair === undefined) return undefined;
  const edge = price / fair - 1;
  return edge >= minEdge ? edge : undefined;
}

// PasBet's second check of a value bet, when the fair odds are Pinnacle's
// (src/db/value.ts on the API's side): the price on the outcome with
// Pinnacle's on the others must make a market paying 99% or more.
export const CONTROL_MIN_PAYOUT = 0.99;

export function passesControl(price: number, selection: string, sharp: Record<string, number> | undefined): boolean {
  if (!sharp || sharp[selection] === undefined) return true;
  const total = Object.entries(sharp).reduce((sum, [outcome, odds]) => sum + 1 / (outcome === selection ? price : odds), 0);
  return 1 / total >= CONTROL_MIN_PAYOUT - 1e-9;
}

// Where the fair odds come from, for their tooltips and explanations.
// In the dative (and genitive) case, which the sentences around it need: "an
// der Betfair-Wettbörse", "die fairen Quoten der Betfair-Wettbörse".
export const REFERENCE_SOURCE = "der Betfair-Wettbörse";

// The football 1X2's fair odds when Pinnacle prices the match.
export const PINNACLE_SOURCE = "Pinnacle";
