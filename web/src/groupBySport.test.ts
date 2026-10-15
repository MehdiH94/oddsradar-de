import { describe, it, expect } from "vitest";
import { groupBySport } from "./groupBySport";
import type { EventWithOdds } from "./types";

function makeEvent(id: string, sport: string): EventWithOdds {
  return { id, sport, competition: "X", startTime: "2026-09-23T16:45:00.000Z", participants: ["A", "B"], byBookmaker: {} };
}

describe("groupBySport", () => {
  it("groups events by sport and sorts groups alphabetically", () => {
    const events = [makeEvent("1", "tennis"), makeEvent("2", "football"), makeEvent("3", "football")];

    const groups = groupBySport(events);

    expect(groups.map(([sport]) => sport)).toEqual(["football", "tennis"]);
    expect(groups[0][1].map((e) => e.id)).toEqual(["2", "3"]);
    expect(groups[1][1].map((e) => e.id)).toEqual(["1"]);
  });

  it("returns an empty array for no events", () => {
    expect(groupBySport([])).toEqual([]);
  });
});
