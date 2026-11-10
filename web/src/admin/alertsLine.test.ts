import { describe, expect, it } from "vitest";
import { alertsLine } from "./alertsLine";

describe("alertsLine", () => {
  it("says the last 7 days' alerts as the weekly report does", () => {
    expect(alertsLine({ surebets: 2, gems: 1, bestSurebet: 0.048, bestGem: 0.231, busiestDay: "Saturday", byBookmaker: "By bookmaker: 20bet 2, LeoVegas 1" })).toBe(
      "Alerts sent in 7 days: 2 surebets (best +4.8 %), 1 value bet (best +23.1 %), most on Saturday. By bookmaker: 20bet 2, LeoVegas 1"
    );
    expect(alertsLine({ surebets: 0, gems: 0, bestSurebet: null, bestGem: null, busiestDay: null, byBookmaker: null })).toBe("Alerts sent in 7 days: 0 surebets, 0 value bets");
  });
});
