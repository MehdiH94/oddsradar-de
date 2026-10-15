import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import {
  fairOdds,
  lineKey,
  midPrice,
  parseEventPlayerMarkets,
  parsePriceFrames,
  parseSearch,
  playerReliability,
} from "../../src/reference/exchange";

// Real captures of the Piwi247 exchange (2026-09-30): its searches for
// "arsenal", "poland", "barcelona" and a word matching nothing, and the price
// socket's frames for the Match Odds markets they found.
const fixture = (name: string) =>
  JSON.parse(gunzipSync(readFileSync(`${__dirname}/fixtures/exchange-${name}.json.gz`)).toString());
const searches = fixture("search");
const frames: unknown[] = fixture("frames");

describe("parseSearch", () => {
  it("reads each football match's Match Odds market and its home, away and draw runners", () => {
    const matches = parseSearch(searches.poland);
    expect(matches).toHaveLength(3);
    expect(matches[0]).toEqual({
      eventId: "36131057",
      participants: ["Poland U21", "Sweden U21"],
      startTime: new Date(1790784000000).toISOString(),
      marketId: "1.263073956",
      runners: { home: 210090, away: 210088, draw: 58805 },
    });
  });

  it("keeps the exchange's names of women's sides", () => {
    const paris = parseSearch(searches.arsenal).find((m) => m.eventId === "36124426");
    expect(paris?.participants).toEqual(["Paris FC (W)", "Arsenal (W)"]);
    expect(paris?.runners).toEqual({ home: 15228979, away: 802851, draw: 58805 });
  });

  it("finds the Match Odds market wherever the search lists it", () => {
    // Betis v Barcelona lists its Asian Handicap first.
    expect(parseSearch(searches.barcelona).find((m) => m.eventId === "36100453")?.marketId).toBe("1.262728850");
  });

  it("answers nothing for a search that finds nothing", () => {
    expect(parseSearch(searches.zzzqqq)).toEqual([]);
    expect(parseSearch({})).toEqual([]);
    expect(parseSearch(null)).toEqual([]);
  });

  it("takes each side's runner by its name, whatever its rank in the market", () => {
    const [event] = searches.poland.content;
    const market = event.topMarkets.find((m: { marketId: string }) => m.marketId === "1.263073956");
    const ranked = {
      ...market,
      runners: market.runners.map((r: { runnerName: string; sortPriority: number }) => ({
        ...r,
        sortPriority: { "Poland U21": 2, "Sweden U21": 1 }[r.runnerName] ?? r.sortPriority,
      })),
    };
    expect(parseSearch({ content: [{ ...event, topMarkets: [ranked] }] })[0].runners).toEqual({
      home: 210090,
      away: 210088,
      draw: 58805,
    });
    // A side without a runner of its name: no market to read.
    const renamed = {
      ...market,
      runners: market.runners.map((r: { runnerName: string }) =>
        r.runnerName === "Sweden U21" ? { ...r, runnerName: "Sweden" } : r
      ),
    };
    expect(parseSearch({ content: [{ ...event, topMarkets: [renamed] }] })).toEqual([]);
  });

  it("skips matches in play, of another sport, or without a draw runner", () => {
    const [event] = searches.poland.content;
    const without = (patch: object) => parseSearch({ content: [{ ...event, ...patch }] });
    expect(without({})).toHaveLength(1);
    expect(without({ inPlay: true })).toEqual([]);
    expect(without({ eventTypeId: "2" })).toEqual([]);
    const market = event.topMarkets.find((m: { marketId: string }) => m.marketId === "1.263073956");
    const noDraw = { ...market, runners: market.runners.filter((r: { runnerName: string }) => r.runnerName !== "The Draw") };
    expect(without({ topMarkets: [noDraw] })).toEqual([]);
  });
});

describe("parsePriceFrames", () => {
  it("reads each runner's best back (highest) and best lay (lowest), the money at them, and the amount matched", () => {
    const poland = parsePriceFrames(frames).get("1.263073956");
    expect(poland?.runners.get(210090)).toEqual({ back: 1.49, lay: 1.52, backSize: 283.03, laySize: 303.01 });
    expect(poland?.runners.get(58805)).toEqual({ back: 5.1, lay: 5.3, backSize: 43.42, laySize: 28.31 });
    expect(poland?.runners.get(210088)).toEqual({ back: 6.8, lay: 7.2, backSize: 98.79, laySize: 16.85 });
    expect(poland?.matched).toBeCloseTo(6364.77);
  });

  it("reads every market of the socket", () => {
    expect(parsePriceFrames(frames).size).toBe(10);
  });

  it("lets a later frame replace the runners it carries", () => {
    const later = { id: "1.263073956", rc: [{ id: 210090, catb: [[1.5, 20]], catl: [[1.53, 10]] }] };
    const poland = parsePriceFrames([...frames, later]).get("1.263073956");
    expect(poland?.runners.get(210090)).toEqual({ back: 1.5, lay: 1.53, backSize: 20, laySize: 10 });
    expect(poland?.runners.get(210088)).toMatchObject({ back: 6.8, lay: 7.2 });
  });

  it("ignores offers with no money left, and falls back to the runner's own ladder", () => {
    const frame = { id: "1.1", rc: [{ id: 1, atb: [[2, 10], [2.1, 0], [2, 4]], atl: [[2.2, 0], [2.3, 5]] }] };
    // Two offers at 2: their money adds up.
    expect(parsePriceFrames([frame]).get("1.1")?.runners.get(1)).toEqual({ back: 2, lay: 2.3, backSize: 14, laySize: 5 });
  });
});

// A price the exchange shows greyed out can't be taken: nobody offers it. A
// surebet rested on such a line of Charleroi - Groningen's handicap
// (14/10/2026), the label still listed and the value greyed out.
describe("parsePriceFrames, for prices greyed out on the exchange", () => {
  const BARCELONA = 278533;
  const ZALGIRIS = 11387338;
  const HANDICAP = "1.263161444";
  const handicap = () => structuredClone(fixture("basketball-frames")[1]) as {
    marketDefinition: { status: string; runners: { id: number; hc: number; status: string }[] };
    rc: { id: number; hc: number; locked: boolean }[];
    [key: string]: unknown;
  };
  const lineOf = (frame: unknown, id: number, hc: number) => parsePriceFrames([frame]).get(HANDICAP)?.lines?.get(lineKey(id, hc));
  const runnerOf = (frame: { rc: { id: number; hc: number }[] }, id: number, hc: number) => frame.rc.find((r) => r.id === id && r.hc === hc)!;

  it("prices a line of the handicap that nothing flags", () => {
    expect(lineOf(handicap(), BARCELONA, -6.5)).toEqual({ back: 2.6, lay: 3.1, backSize: 1.32, laySize: 76.15 });
    expect(lineOf(handicap(), ZALGIRIS, 6.5)).toMatchObject({ back: 1.49, lay: 1.63 });
  });

  it("leaves out a runner the exchange locks, at that line only", () => {
    const frame = handicap();
    runnerOf(frame, BARCELONA, -6.5).locked = true;
    const market = parsePriceFrames([frame]).get(HANDICAP)!;
    expect(market.lines!.get(lineKey(BARCELONA, -6.5))).toBeUndefined();
    // The same runner at another line, and the other team at that line.
    expect(market.lines!.get(lineKey(BARCELONA, -14.5))).toMatchObject({ back: 5.2, lay: 7.8 });
    expect(market.lines!.get(lineKey(ZALGIRIS, 6.5))).toMatchObject({ back: 1.49, lay: 1.63 });
    expect(market.matched).toBeGreaterThan(0);
  });

  it("leaves out a runner whose status is not ACTIVE, at that line only", () => {
    for (const status of ["REMOVED", "SUSPENDED", "HIDDEN"]) {
      const frame = handicap();
      frame.marketDefinition.runners.find((r) => r.id === BARCELONA && r.hc === -6.5)!.status = status;
      expect(lineOf(frame, BARCELONA, -6.5), status).toBeUndefined();
      expect(lineOf(frame, BARCELONA, -14.5), status).toBeDefined();
      expect(lineOf(frame, ZALGIRIS, 6.5), status).toBeDefined();
    }
  });

  it("leaves out every price of a market that is not open, or whose betting is disabled", () => {
    for (const patch of [{ status: "SUSPENDED" }, { status: "CLOSED" }]) {
      const frame = handicap();
      Object.assign(frame.marketDefinition, patch);
      const market = parsePriceFrames([frame]).get(HANDICAP)!;
      expect(market.runners.size, patch.status).toBe(0);
      expect(market.lines?.size ?? 0, patch.status).toBe(0);
      expect(market.matched, patch.status).toBeGreaterThan(0);
    }
    for (const flag of ["bettingEnabled", "enabled"]) {
      expect(lineOf({ ...handicap(), [flag]: false }, BARCELONA, -6.5), flag).toBeUndefined();
    }
  });

  it("keeps a market's back prices and leaves out its lays when it disables them", () => {
    const line = lineOf({ ...handicap(), disabledLayOdds: true }, BARCELONA, -6.5)!;
    expect(line).toMatchObject({ back: 2.6, backSize: 1.32 });
    expect(line.lay).toBeUndefined();
    expect(line.laySize).toBeUndefined();
  });

  it("reads a runner locked by a later frame as gone, whatever prices it carries", () => {
    const base = { id: "1.1", rc: [{ id: 1, catb: [[2, 10]], catl: [[2.2, 10]] }, { id: 2, catb: [[3, 10]], catl: [[3.3, 10]] }] };
    const later = { id: "1.1", rc: [{ id: 1, locked: true, catb: [[2.1, 10]], catl: [[2.3, 10]] }] };
    const market = parsePriceFrames([base, later]).get("1.1")!;
    expect(market.runners.has(1)).toBe(false);
    expect(market.runners.get(2)).toMatchObject({ back: 3, lay: 3.3 });
    // Unlocked again, it is priced again.
    const open = { id: "1.1", rc: [{ id: 1, locked: false, catb: [[2.1, 10]], catl: [[2.3, 10]] }] };
    expect(parsePriceFrames([base, later, open]).get("1.1")?.runners.get(1)).toMatchObject({ back: 2.1, lay: 2.3 });
  });

  it("forgets a market's prices when a later frame suspends it, and takes them again once it reopens", () => {
    const base = { id: "1.1", marketDefinition: { status: "OPEN" }, rc: [{ id: 1, catb: [[2, 10]], catl: [[2.2, 10]] }], tv: "50" };
    const suspended = { id: "1.1", marketDefinition: { status: "SUSPENDED" }, rc: [] };
    const gone = parsePriceFrames([base, suspended]).get("1.1")!;
    expect(gone.runners.size).toBe(0);
    expect(gone.matched).toBe(50);
    // A frame of changes in between says nothing of the market's state: it stays suspended.
    const change = { id: "1.1", rc: [{ id: 1, catb: [[2.5, 10]], catl: [[2.7, 10]] }] };
    expect(parsePriceFrames([base, suspended, change]).get("1.1")!.runners.size).toBe(0);
    const reopened = { id: "1.1", marketDefinition: { status: "OPEN" }, rc: [{ id: 1, catb: [[2.5, 10]], catl: [[2.7, 10]] }] };
    expect(parsePriceFrames([base, suspended, reopened]).get("1.1")!.runners.get(1)).toMatchObject({ back: 2.5, lay: 2.7 });
  });

  it("gives no fair odds to a 1X2 with an outcome greyed out", () => {
    // Poland U21 v Sweden U21, whose three outcomes are priced tightly.
    const frame = structuredClone(frames.find((f) => (f as { id: string }).id === "1.263073956")) as {
      id: string;
      rc: { id: number; locked?: boolean }[];
    };
    const prices = () => {
      const runners = parsePriceFrames([frame]).get(frame.id)!.runners;
      return { "1": runners.get(210090), X: runners.get(58805), "2": runners.get(210088) };
    };
    expect(fairOdds(prices())).not.toBeNull();
    frame.rc.find((r) => r.id === 58805)!.locked = true;
    expect(fairOdds(prices())).toBeNull();
  });
});

describe("fairOdds", () => {
  const outcomes = (market: string, [home, draw, away]: number[]) => {
    const runners = parsePriceFrames(frames).get(market)!.runners;
    return { "1": runners.get(home), X: runners.get(draw), "2": runners.get(away) };
  };

  it("scales the mid prices so that the three outcomes' chances add up to 100%", () => {
    const fair = fairOdds(outcomes("1.263073956", [210090, 58805, 210088]))!;
    // Mid prices 1.505, 5.2 and 7, whose chances add up to 99.96%.
    const total = 1 / 1.505 + 1 / 5.2 + 1 / 7;
    expect(fair["1"]).toBeCloseTo(1.505 * total, 6);
    expect(fair.X).toBeCloseTo(5.2 * total, 6);
    expect(fair["2"]).toBeCloseTo(7 * total, 6);
    expect(1 / fair["1"] + 1 / fair.X + 1 / fair["2"]).toBeCloseTo(1, 10);
  });

  it("gives none when an outcome's lay is more than 10% above its back", () => {
    // Poland U19 v Kazakhstan U19: 5.5 to back, 8.8 to lay.
    expect(fairOdds(outcomes("1.263156308", [820889, 58805, 2128774]))).toBeNull();
    const ok = { back: 2, lay: 2.2 };
    expect(fairOdds({ "1": ok, X: ok, "2": { back: 2, lay: 2.21 } })).toBeNull();
    expect(fairOdds({ "1": ok, X: ok, "2": ok })).not.toBeNull();
  });

  it("gives none when an outcome lacks a back or a lay", () => {
    const ok = { back: 3, lay: 3.1 };
    expect(fairOdds({ "1": ok, X: ok, "2": { back: 3 } })).toBeNull();
    expect(fairOdds({ "1": ok, X: ok, "2": { lay: 3 } })).toBeNull();
    expect(fairOdds({ "1": ok, X: ok, "2": undefined })).toBeNull();
  });
});

// A real event/details answer (France v Italy, 2026-10-01, 59 markets).
describe("the players' markets", () => {
  const details = fixture("details");

  it("reads the scorer, first scorer, 2 goals and hat-trick markets and their players, under our keys", () => {
    const markets = parseEventPlayerMarkets(details);
    expect(markets.map((m) => [m.market, m.marketId, Object.keys(m.runners).length])).toEqual([
      ["first_scorer", "1.263076775", 48],
      ["anytime_scorer", "1.263076777", 48],
      ["scorer_goals|2", "1.263076747", 10],
      ["scorer_goals|3", "1.263076748", 10],
    ]);
    const scorers = markets.find((m) => m.market === "anytime_scorer")!;
    expect(scorers.runners[10536894]).toBe("Ousmane Dembele");
    // The first scorer's "No Goalscorer" is no player.
    expect(Object.values(markets[0].runners)).not.toContain("No Goalscorer");
  });

  it("leaves out the players' shots on target, and answers nothing before the exchange lists them", () => {
    expect(parseEventPlayerMarkets(details).some((m) => m.market.includes("shot"))).toBe(false);
    const early = {
      ...details,
      marketCatalogues: details.marketCatalogues.filter(
        (m: { description: { marketType: string } }) =>
          !["TO_SCORE", "FIRST_GOAL_SCORER", "TO_SCORE_2_OR_MORE", "TO_SCORE_HATTRICK"].includes(m.description.marketType)
      ),
    };
    expect(parseEventPlayerMarkets(early)).toEqual([]);
    expect(parseEventPlayerMarkets({})).toEqual([]);
  });

  it("reads the captured scorers' prices: backs only, with 2.39 € on each", () => {
    const toScore = parsePriceFrames(fixture("details-frames")).get("1.263076777")!;
    expect(toScore.runners.get(10536894)).toEqual({ back: 1.98, lay: undefined, backSize: 2.39, laySize: undefined });
    expect(playerReliability(toScore.runners.get(10536894)!)).toEqual({
      priced: false,
      loose: false,
      shown: false,
      spread: false,
      strict: false,
    });
  });

  it("shows a player's fair odds from 20% apart with 20 € on both sides, and counts the other levels", () => {
    const level = (back: number, lay: number, backSize: number, laySize: number) =>
      playerReliability({ back, lay, backSize, laySize });
    expect(level(2, 2.2, 20, 20)).toEqual({ priced: true, loose: true, shown: true, spread: true, strict: true });
    // Shown up to 20% apart, from 20 € on each side.
    expect(level(2, 2.4, 20, 20)).toEqual({ priced: true, loose: true, shown: true, spread: false, strict: false });
    expect(level(2, 2.41, 20, 20).shown).toBe(false);
    expect(level(2, 2.4, 19.99, 500).shown).toBe(false);
    // As tight as a 1X2's: "strict", from 10% apart.
    expect(level(2, 2.21, 20, 20).strict).toBe(false);
    // Tight whatever the money: "spread".
    expect(level(2, 2.2, 2, 2)).toEqual({ priced: true, loose: false, shown: false, spread: true, strict: false });
    // "loose": 20% apart from 10 €.
    expect(level(2, 2.4, 10, 10)).toEqual({ priced: true, loose: true, shown: false, spread: false, strict: false });
    expect(level(2, 2.4, 9.99, 10).loose).toBe(false);
    // A back and a lay, however far apart.
    expect(level(2, 9, 1, 1)).toEqual({ priced: true, loose: false, shown: false, spread: false, strict: false });
    expect(playerReliability({ back: 2 }).priced).toBe(false);
    expect(playerReliability({ back: 2.2, lay: 2 }).priced).toBe(false);
  });

  it("makes a player's fair odds the mid price, unscaled", () => {
    expect(midPrice({ back: 2, lay: 2.2 })).toBeCloseTo(2.1, 10);
    expect(midPrice({ back: 2 })).toBeUndefined();
  });
});
