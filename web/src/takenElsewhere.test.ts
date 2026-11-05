import { describe, expect, it } from "vitest";
import { takenElsewhereLabel } from "./takenElsewhere";
import type { TakenSurebets } from "./takenSurebets";
import type { TakenValueBets } from "./takenValueBets";

const surebets = new Map([
  ["s1", { eventId: "gala-fener" }],
  ["s2", { eventId: "gala-fener" }],
  ["s3", { eventId: "other" }],
]) as unknown as TakenSurebets;
const valueBets = new Map([["v1", { eventId: "gala-fener" }]]) as unknown as TakenValueBets;

describe("takenElsewhereLabel", () => {
  it("counts the other bets taken on the match, not the row's own", () => {
    expect(takenElsewhereLabel("gala-fener", "s1", surebets, valueBets)).toBe("Auf diesem Spiel schon genommen: 1 Surebet, 1 Value Bet");
    expect(takenElsewhereLabel("gala-fener", "v1", surebets, valueBets)).toBe("Auf diesem Spiel schon genommen: 2 Surebets");
    expect(takenElsewhereLabel("gala-fener", "new", undefined, valueBets)).toBe("Auf diesem Spiel schon genommen: 1 Value Bet");
  });

  it("is null when nothing else was taken on it", () => {
    expect(takenElsewhereLabel("other", "s3", surebets, valueBets)).toBeNull();
    expect(takenElsewhereLabel("psg-om", "x", surebets, valueBets)).toBeNull();
  });
});
