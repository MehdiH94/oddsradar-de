import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { matchEvents } from "../../src/matcher/match";
import { RawEvent } from "../../src/types";

// The biathlon winners listed on 15/10/2026 (production, plus Betify's two from
// staging, and NetBet's four, whose titles name no "classement" or "général"),
// each as the bookmaker that seeded it listed it. The bookmakers date a
// season standings months apart (the first race, the relay's weekend, the
// season's end) and title it their own way, and the matcher paired none of them.
// Kept as the people running the site grouped them by hand: sourceId is the
// event's id on the dashboard that day.
const SET: Record<string, RawEvent[]> = JSON.parse(
  gunzipSync(readFileSync(join(__dirname, "fixtures/biathlon-winners-2026-10-15.json.gz"))).toString()
);

// Each group: the dashboard ids (first 4 characters) that must end up one event.
const EXPECTED_GROUPS: Record<string, string[]> = {
  "overall sprint, men": ["4fdd", "20b5", "nb02"],
  "overall sprint, women": ["07db", "86b9"],
  "overall relay, men": ["c8da", "2393", "f311", "nb01"],
  "overall relay, women": ["13ac", "8163", "c517"],
  "overall World Cup, men": ["8eeb", "d20a", "3184", "nb03"],
  "overall World Cup, women": ["cfd4", "7a80", "7c93", "nb04"],
  // A race of the season, not the standings of the competition.
  "Otepää sprint, men": ["1b80"],
  "Otepää sprint, women": ["484d"],
};

describe("matchEvents over the real biathlon winners of 15/10/2026", () => {
  const events = matchEvents(SET);
  const idsOf = (e: (typeof events)[number]) =>
    Object.values(e.sources!)
      .map((s) => s.sourceId!.slice(0, 4))
      .sort();

  it("lists the same number of events as there are groups", () => {
    expect(events).toHaveLength(Object.keys(EXPECTED_GROUPS).length);
  });

  for (const [name, ids] of Object.entries(EXPECTED_GROUPS)) {
    it(`groups ${name}`, () => {
      const seeded = new Set(ids);
      const holders = events.filter((e) => e.sources && Object.values(e.sources).some((s) => seeded.has(s.sourceId!.slice(0, 4))));
      expect(holders).toHaveLength(1);
      expect(Object.keys(holders[0].sources!).length).toBe(ids.length);
      expect(idsOf(holders[0])).toEqual([...ids].sort());
    });
  }
});
