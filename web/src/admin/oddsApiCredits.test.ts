import { describe, it, expect } from "vitest";
import { oddsApiCreditsLabel } from "./oddsApiCredits";

describe("oddsApiCreditsLabel", () => {
  it("says the credits left and when they were told, spent at or under the floor", () => {
    const left = oddsApiCreditsLabel({ creditsLeft: 494, checkedAt: "2026-11-01T04:08:00.000Z", floor: 20 })!;
    expect(left.spent).toBe(false);
    expect(left.text).toMatch(/^494 credits left this month \(checked 01\/11\/2026, \d\d:08\)$/);
    const spent = oddsApiCreditsLabel({ creditsLeft: 20, checkedAt: null, floor: 20 })!;
    expect(spent).toEqual({ text: "20 credits left this month: at the floor of 20, no reads until they renew", spent: true });
  });

  it("says how often the worker reads, paced to last the month", () => {
    expect(oddsApiCreditsLabel({ creditsLeft: 356, checkedAt: null, floor: 20, refreshMinutes: 15 })!.text).toBe("356 credits left this month, a read every 15 min");
    expect(oddsApiCreditsLabel({ creditsLeft: 356, checkedAt: null, floor: 20, refreshMinutes: 760 })!.text).toBe("356 credits left this month, a read every 12 h 40 min");
    expect(oddsApiCreditsLabel({ creditsLeft: 356, checkedAt: null, floor: 20, refreshMinutes: 720 })!.text).toBe("356 credits left this month, a read every 12 h");
  });

  it("says nothing before the worker read it, and no count before the API told one", () => {
    expect(oddsApiCreditsLabel(null)).toBeNull();
    expect(oddsApiCreditsLabel({ creditsLeft: null, checkedAt: null, floor: 20 })).toEqual({ text: "credits left not told yet", spent: false });
  });
});
