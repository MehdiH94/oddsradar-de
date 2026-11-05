import type { TakenSurebets } from "./takenSurebets";
import type { TakenValueBets } from "./takenValueBets";

// What the account already took on a match, other than the row's own bet
// (its key): "Auf diesem Spiel schon genommen: 1 Surebet, 1 Value Bet", so
// that a second bet on the same match is a choice, not an accident. Null when
// nothing else was taken on it.
export function takenElsewhereLabel(
  eventId: string,
  ownKey: string,
  surebets: TakenSurebets | undefined,
  valueBets: TakenValueBets | undefined
): string | null {
  const count = (map: ReadonlyMap<string, { eventId: string }> | undefined) =>
    [...(map ?? [])].filter(([key, item]) => key !== ownKey && item.eventId === eventId).length;
  const s = count(surebets);
  const v = count(valueBets);
  if (s + v === 0) return null;
  const parts = [s > 0 ? `${s} Surebet${s === 1 ? "" : "s"}` : null, v > 0 ? `${v} Value Bet${v === 1 ? "" : "s"}` : null].filter(Boolean);
  return `Auf diesem Spiel schon genommen: ${parts.join(", ")}`;
}
