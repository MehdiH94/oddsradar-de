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

// Where the fair odds come from, for their tooltips and explanations.
export const REFERENCE_SOURCE = "the Betfair exchange (via Piwi247)";
