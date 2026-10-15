import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { matchEvents } from "../../src/matcher/match";
import { NETBET, readSportncoTournaments } from "../../src/scraper/sportnco";
import { parseUnibetPage } from "../../src/scraper/unibet";
import { readVbetSport, VbetReply } from "../../src/scraper/vbet";
import { RawEvent } from "../../src/types";

// The Cup's race and championship as three bookmakers list them, read by their
// own scrapers from the real captures of 8/10/2026 (tests/scraper/fixtures):
// Vbet's "Bank of America 400" (39 drivers) and its championship "Nascar Cup
// Series 2026" (16 contenders, all of them in the race's field), NetBet's and
// Unibet's race and Unibet's championship.
const fixture = (name: string) => JSON.parse(gunzipSync(readFileSync(join(__dirname, "../scraper/fixtures", name))).toString());

const unibet: RawEvent[] = parseUnibetPage(fixture("unibet-races-page.json.gz")).filter((e) => e.sport === "automobile");
const netbet: RawEvent[] = readSportncoTournaments(fixture("sportnco-netbet-winners-automobile.json.gz"), NETBET).filter(
  (e) => e.sport === "automobile"
);
const NETBET_RACE_START = netbet.find((e) => /Roval/.test(e.participants[0]))!.startTime;

// Vbet dates a race and its championship alike (10/10 at 17:00, a day before
// the race itself); the matcher can't tell them apart by that date. Here the
// championship is dated at NetBet's start of the race, as it is for the
// bookmakers that date a race by its own day.
function vbetNascar(championshipStart?: string): RawEvent[] {
  const reply: VbetReply = fixture("vbet-Nascar.json.gz");
  if (championshipStart) {
    for (const sport of Object.values(reply.data!.data!.sport!))
      for (const region of Object.values(sport.region!))
        for (const competition of Object.values(region.competition!))
          if (/Compétition/.test(competition.name)) {
            for (const game of Object.values(competition.game!)) game.start_ts = Date.parse(championshipStart) / 1000;
          }
  }
  return readVbetSport(reply, "Nascar");
}

describe("matchEvents over the Cup's race and championship of NetBet, Unibet and Vbet", () => {
  const priceOf = (event: { byBookmaker: Record<string, { selection: string; price: number }[]> }, bookmaker: string, driver: string) =>
    event.byBookmaker[bookmaker]?.find((o) => o.selection === driver)?.price;

  for (const [label, championshipStart] of [
    ["dated as Vbet does", undefined],
    ["dated at NetBet's start of the race", NETBET_RACE_START],
  ] as const) {
    describe(`with Vbet's championship ${label}`, () => {
      const events = matchEvents({ netbet, unibet, vbet: vbetNascar(championshipStart) });
      const race = events.find((e) => /Roval/.test(e.participants[0]))!;

      it("gives the race Vbet's prices for the race, not the championship's", () => {
        expect(Object.keys(race.byBookmaker).sort()).toEqual(["netbet", "unibet", "vbet"]);
        // Larson: 4.75 to win the race, 1.83 to win the championship.
        expect(priceOf(race, "vbet", "Kyle Larson")).toBe(4.75);
        expect(priceOf(race, "vbet", "Denny Hamlin")).toBe(5.3);
        expect(race.byBookmaker.vbet).toHaveLength(39);
      });
    });
  }
});
