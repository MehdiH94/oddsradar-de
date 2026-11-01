import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatOddsApiCredits, readOddsApiCredits } from "../../src/scraper/oddsApiCredits";

const file = (content?: string) => {
  const path = join(mkdtempSync(join(tmpdir(), "odds-api-")), "cache.json");
  if (content !== undefined) writeFileSync(path, content);
  return path;
};
const NOW = Date.parse("2026-11-01T04:20:00.000Z");

describe("readOddsApiCredits", () => {
  it("reads the credits left and when they were told from the worker's cache file", () => {
    const credits = readOddsApiCredits(file(JSON.stringify({ competitions: {}, creditsLeft: 494, creditsCheckedAt: "2026-11-01T04:08:00.000Z", refreshMinutes: 15 })));
    expect(credits).toEqual({ creditsLeft: 494, checkedAt: "2026-11-01T04:08:00.000Z", floor: 20, refreshMinutes: 15 });
  });

  it("gives null without a file or with a broken one, no count before the API told one", () => {
    expect(readOddsApiCredits(file())).toBeNull();
    expect(readOddsApiCredits(file("{not json"))).toBeNull();
    expect(readOddsApiCredits(file(JSON.stringify({ competitions: {} })))).toEqual({ creditsLeft: null, checkedAt: null, floor: 20, refreshMinutes: null });
  });
});

describe("formatOddsApiCredits", () => {
  it("says how many are left and since when, and when the reads have stopped", () => {
    expect(formatOddsApiCredits({ creditsLeft: 494, checkedAt: "2026-11-01T04:08:00.000Z", floor: 20, refreshMinutes: 1000 }, NOW)).toBe(
      "The Odds API (tipico, winamaxde, Pinnacle): 494 credits left, checked 12 min ago; a read every 1000 min"
    );
    expect(formatOddsApiCredits({ creditsLeft: 12, checkedAt: "2026-11-01T04:08:00.000Z", floor: 20, refreshMinutes: 15 }, NOW)).toBe(
      "The Odds API (tipico, winamaxde, Pinnacle): 12 credits left, checked 12 min ago; at or under the floor of 20: no reads until they renew"
    );
    expect(formatOddsApiCredits({ creditsLeft: null, checkedAt: null, floor: 20, refreshMinutes: null }, NOW)).toBe("The Odds API (tipico, winamaxde, Pinnacle): credits left not told yet");
    expect(formatOddsApiCredits(null, NOW)).toBe("The Odds API (tipico, winamaxde, Pinnacle): never read here (no cache file)");
  });
});
