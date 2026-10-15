import { ExchangePlayer, PlayerSignal, playerSignals } from "./playerValue";

// A tennis match's value bets on its markets but its winner (whose reference
// is a 1X2's, src/db/value.ts): its games handicaps and totals, sets... As
// the players' (src/db/playerValue.ts), their exchange prices moving more:
// against the fair odds when they are reliable, else against the lay as a
// ceiling, from 5%. Never against the other bookmaker.
export const TENNIS_VALUE_MIN_EDGE = 0.05;

const THRESHOLDS = { fair: TENNIS_VALUE_MIN_EDGE, lay: TENNIS_VALUE_MIN_EDGE, bookmaker: Infinity };

// One market's value bets: `exchange` is its outcomes' fair odds and lay,
// `bookmakers` every bookmaker's prices by outcome.
export function tennisSignals(
  exchange: ReadonlyMap<string, ExchangePlayer>,
  bookmakers: ReadonlyMap<string, ReadonlyMap<string, number>>
): PlayerSignal[] {
  return playerSignals(exchange, bookmakers, THRESHOLDS);
}
