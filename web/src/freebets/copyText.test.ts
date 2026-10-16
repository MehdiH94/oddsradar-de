import { describe, expect, it } from "vitest";
import { copyText } from "./copyText";
import { PLAN_ONE } from "./testData";

describe("copyText", () => {
  it("lists a bookmaker's bets, one line each, to paste where they are placed", () => {
    expect(copyText(PLAN_ONE.bookmakers[0])).toBe("LeoVegas: 2 freebet bets\n- Paris SG: 12.40 FB\n- Marseille: 16.00 FB");
    expect(copyText(PLAN_ONE.bookmakers[1])).toBe("Merkur Bets: 1 freebet bet\n- Draw: 24.00 FB");
  });

  it("names the matches of a combo's bet", () => {
    const group = { bookmaker: "merkurbets" as const, fb: 10, used: 5, bets: [{ outcomes: ["A", "Draw", "C"], label: "A + Nul + C", odds: 20, stake: 5, gain: 95 }] };
    expect(copyText(group)).toBe("Merkur Bets: 1 freebet bet\n- A + Nul + C: 5.00 FB");
  });
});
