// tests/matcher/match.real-fixtures.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { snapshotToRawEvents, WinamaxSnapshot } from "../../src/scraper/winamax";
import { parseBetclicFrame } from "../../src/scraper/betclic";
import { matchEvents } from "../../src/matcher/match";
import { MARKET_1X2 } from "../../src/scraper/canonical";
import { CanonicalEvent, RawOdds } from "../../src/types";

// End-to-end regression test for the cross-bookmaker selection-canonicalization
// bug: real captured API data -> real parsers -> real matcher. Every other
// matcher test builds synthetic RawEvent objects with already-canonical
// selections ("1"), which is exactly why this bug shipped originally -- no
// test ever let real bookmaker-specific outcome labels cross the
// parser/matcher boundary. This test deliberately fabricates nothing.
//
// The real match: Japon vs Uruguay (a friendly), present in both live
// captures with matching raw selection labels on both sides --
// Winamax: "Japon" / "Match nul" / "Uruguay"
// Betclic:  "Japon" / "Nul"       / "Uruguay"
// -- both bookmakers use the plain country name for a national team (never
// abbreviated), which is why this match was chosen over a club match: an
// earlier attempt used Seattle Sounders vs Real Salt Lake, but Winamax
// abbreviates that outcome to "Seattle", which falls below the matcher's
// fixed 0.75 name-similarity threshold against the full "Seattle Sounders"
// participant name -- a real, pre-existing matcher limitation (src/matcher/match.ts
// is out of scope for this plan), not a bug this test should paper over by
// picking a match where canonicalization happens to fail. Country names
// avoid that whole class of risk. If canonicalization ever regresses on a
// name that DOES match exactly, this is the test that catches it.
//
// Markets matter as much as selections: the frontend looks a price up by the
// (market, selection) PAIR. The two APIs name this market differently
// (Winamax "Résultat", Betclic "Résultat du match (t. rég)"), so each parser
// must emit the shared key "1X2" instead -- an earlier port of this test
// only compared selections, and that is exactly how emitting the raw API
// names slipped through with every shared match silently showing one
// bookmaker's price and a dash.

const FIXTURES_DIR = join(__dirname, "../scraper/fixtures");

function loadWinamaxEvents() {
  const snapshot: WinamaxSnapshot = JSON.parse(
    readFileSync(join(FIXTURES_DIR, "winamax-japon-uruguay-snapshot.json"), "utf-8")
  );
  return snapshotToRawEvents(snapshot);
}

function loadBetclicEvents() {
  const raw = readFileSync(join(FIXTURES_DIR, "betclic-matchservice-response.bin"));
  const declaredLen = raw.readUInt32BE(1);
  return parseBetclicFrame(raw.subarray(5, 5 + declaredLen));
}

function selectionsFor(odds: RawOdds[]): string[] {
  return odds.map((o) => o.selection).sort();
}

describe("matchEvents over real captured API data", () => {
  let sharedEvent: CanonicalEvent;
  let allMatched: CanonicalEvent[];

  const winamaxEvents = loadWinamaxEvents();
  const betclicEvents = loadBetclicEvents();

  // Sanity: both fixtures really did parse into real events.
  expect(winamaxEvents.length).toBeGreaterThan(0);
  expect(betclicEvents.length).toBeGreaterThan(0);

  allMatched = matchEvents({ winamax: winamaxEvents, betclic: betclicEvents });
  const shared = allMatched.filter((e) => Object.keys(e.byBookmaker).length === 2);
  // Documented real-data assertion: the Winamax fixture contains exactly the
  // one match also present in the (40-match) Betclic fixture.
  expect(shared).toHaveLength(1);
  sharedEvent = shared[0];

  it("finds the one real match present in both bookmakers' captures", () => {
    expect(sharedEvent.sport).toBe("football");
    expect(sharedEvent.participants).toEqual(["Japon", "Uruguay"]);
    expect(Object.keys(sharedEvent.byBookmaker).sort()).toEqual(["betclic", "winamax"]);
  });

  it("aligns both bookmakers' selection labels onto the same canonical keys", () => {
    const winamax = sharedEvent.byBookmaker.winamax;
    const betclic = sharedEvent.byBookmaker.betclic;

    // The core assertion: the two bookmakers' sets of selection keys are EQUAL --
    // real labels from both real parsers, run through the real, unchanged matcher.
    // This is what makes cross-bookmaker comparison possible at all.
    expect(selectionsFor(winamax)).toEqual(selectionsFor(betclic));
    expect(selectionsFor(winamax)).toEqual(["1", "2", "X"]);

    // And the markets line up too, so the frontend's market+selection pair matches.
    expect(new Set(winamax.map((o) => o.market))).toEqual(new Set(["1X2"]));
    expect(new Set(betclic.map((o) => o.market))).toEqual(new Set(["1X2"]));
  });

  it("gives every canonical selection a real price from BOTH bookmakers", () => {
    // This is the getBestBookmaker-style lookup (web/src/bestOdds.ts): by
    // market AND selection, so it only succeeds if both are shared keys.
    const lookup = (odds: RawOdds[], selection: string) =>
      odds.find((o) => o.market === MARKET_1X2 && o.selection === selection);

    for (const selection of ["1", "X", "2"]) {
      const winamaxOdd = lookup(sharedEvent.byBookmaker.winamax, selection);
      const betclicOdd = lookup(sharedEvent.byBookmaker.betclic, selection);

      expect(winamaxOdd, `winamax is missing selection "${selection}"`).toBeDefined();
      expect(betclicOdd, `betclic is missing selection "${selection}"`).toBeDefined();
      expect(winamaxOdd!.price).toBeGreaterThan(1);
      expect(betclicOdd!.price).toBeGreaterThan(1);
    }

    // Concretely, on this real data the two books genuinely disagree, so the
    // "meilleure cote" highlight has something real to point at: the away
    // price differs materially (3.75 Winamax vs 4.00 Betclic).
    const winamaxAway = lookup(sharedEvent.byBookmaker.winamax, "2")!;
    const betclicAway = lookup(sharedEvent.byBookmaker.betclic, "2")!;
    expect(betclicAway.price).toBeGreaterThan(winamaxAway.price);
  });

  it("leaves single-bookmaker events canonicalized too, not just merged ones", () => {
    // Canonicalization must not depend on a second bookmaker showing up -- an
    // event only one book covers still has to store canonical keys, or it would
    // start comparing incorrectly the moment the other book does list it.
    const soloFootball = allMatched.filter(
      (e) => Object.keys(e.byBookmaker).length === 1 && e.sport === "football" && e.participants.length === 2
    );
    expect(soloFootball.length).toBeGreaterThan(0);

    const canonicalKeys = new Set(["1", "X", "2"]);
    const anyCanonicalized = soloFootball.some((e) =>
      Object.values(e.byBookmaker).some((odds) =>
        odds.some((o) => o.market === MARKET_1X2 && canonicalKeys.has(o.selection))
      )
    );
    expect(anyCanonicalized).toBe(true);
  });
});
