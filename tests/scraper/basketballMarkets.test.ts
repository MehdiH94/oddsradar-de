import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { readWinamaxMarkets, WinamaxMatchReply } from "../../src/scraper/winamaxMarkets";
import { readBetclicMarkets, readBetclicMatchPage } from "../../src/scraper/betclicMarkets";
import { familiesOf, parseMarketKey } from "../../src/markets/catalog";
import { RawOdds } from "../../src/types";

// Barcelone - Zalgiris Kaunas (Euroleague), 9 October 2026 at 18:30 UTC, at
// Winamax and Betclic: their own replies, captured that day (Winamax's
// "match:<id>", Betclic's default page and tabs).
const FIXTURES = "tests/scraper/fixtures";
const json = (file: string) => JSON.parse(gunzipSync(readFileSync(`${FIXTURES}/${file}`)).toString());

const WINAMAX_ID = "73263016";
const winamaxReply = (): WinamaxMatchReply => json(`markets/winamax-barcelone-zalgiris.json.gz`);
// The default page first: it names the match's teams and tabs.
const betclicPages = () =>
  readdirSync(`${FIXTURES}/markets`)
    .filter((f) => f.startsWith("betclic-barcelone-zalgiris-"))
    .sort((a, b) => Number(b.includes("-default.")) - Number(a.includes("-default.")))
    .map((f) => readBetclicMatchPage(gunzipSync(readFileSync(`${FIXTURES}/markets/${f}`))));

// market -> selection -> price
function grid(odds: RawOdds[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const o of odds) {
    if (!out.has(o.market)) out.set(o.market, new Map());
    out.get(o.market)!.set(o.selection, o.price);
  }
  return out;
}

const winamax = grid(readWinamaxMarkets(winamaxReply(), WINAMAX_ID));
const betclic = grid(readBetclicMarkets(betclicPages()));

describe("a basketball match's result in regular time", () => {
  // A draw is possible there (12 to 17 for it), the match going to overtime
  // when it is level: the 1X2 of the catalog, at each bookmaker.
  it("is read at both bookmakers, in their own team order", () => {
    expect(winamax.get("1X2")).toEqual(new Map([["1", 1.8], ["X", 12.5], ["2", 2.05]]));
    expect(betclic.get("1X2")).toEqual(new Map([["1", 1.82], ["X", 12.75], ["2", 2.12]]));
  });

  it("is not the winner of the match, overtime included, which both bookmakers list on their own", () => {
    for (const markets of [winamax, betclic]) expect(markets.has("Vainqueur du match")).toBe(false);
  });
});

const m = (...entries: [string, number][]) => new Map(entries);

describe("a basketball match's handicap", () => {
  // The first team's line, whichever side a bookmaker writes: Barcelone -6.5 is
  // "1" at -6.5, Zalgiris +6.5 "2". The match's own handicaps are overtime included.
  it("is read as the first team's line at both bookmakers, whose prices agree", () => {
    expect(winamax.get("spread|-6.5")).toEqual(m(["1", 2.45], ["2", 1.33]));
    expect(betclic.get("spread|-6.5")).toEqual(m(["1", 2.61], ["2", 1.38]));
    // The second team's line is the first's, changed in sign.
    expect(winamax.get("spread|9.5")).toEqual(m(["1", 1.12], ["2", 4]));
  });

  it("is Betclic's margin: \"gagne de 7 ou +\" is -6.5, \"ne perd pas ou perd de 6 ou -\" +6.5", () => {
    expect([...betclic.keys()].filter((k) => k.startsWith("spread|")).sort()).toHaveLength(21);
    // Both sides of every line, so each has a TRJ.
    for (const [key, prices] of betclic) if (key.startsWith("spread|")) expect([...prices.keys()].sort()).toEqual(["1", "2"]);
  });
});

describe("a basketball match's totals", () => {
  it("are over and under a line of half a point, at both bookmakers", () => {
    expect(winamax.get("total_points|174.5")).toEqual(m(["over", 1.76], ["under", 1.7]));
    expect(betclic.get("total_points|174.5")).toEqual(m(["over", 1.76], ["under", 1.82]));
  });

  it("are read for each team, the first team's being \"@1\"", () => {
    expect(winamax.get("team_points@1|87.5")).toEqual(m(["over", 1.72], ["under", 1.74]));
    expect(winamax.get("team_points@2|84.5")).toEqual(m(["over", 1.5], ["under", 2]));
    expect(betclic.get("team_points@1|87.5")).toEqual(m(["over", 1.77], ["under", 1.86]));
  });

  it("leave out a line of a whole number, which refunds a push", () => {
    for (const markets of [winamax, betclic]) {
      for (const key of markets.keys()) {
        const parsed = parseMarketKey(key);
        if (parsed.kind === "family" && parsed.line !== undefined) expect(Number.isInteger(parsed.line), key).toBe(false);
      }
    }
  });

  it("are combined with the winner, overtime included, at both bookmakers", () => {
    expect(winamax.get("winner_total|174.5")).toEqual(m(["1&under", 2.75], ["1&over", 2.95], ["2&under", 3.25], ["2&over", 3.4]));
    expect(betclic.get("winner_total|174.5")).toEqual(m(["1&over", 3.06], ["1&under", 3.06], ["2&over", 3.53], ["2&under", 3.53]));
  });
});

describe("a basketball match's other markets", () => {
  it("has an overtime that both bookmakers price", () => {
    expect(winamax.get("overtime")).toEqual(m(["yes", 10], ["no", 1.02]));
    expect(betclic.get("overtime")).toEqual(m(["yes", 12.75], ["no", 1.03]));
  });

  it("has the refund on a draw, in regular time", () => {
    expect(winamax.get("draw_no_bet")).toEqual(m(["1", 1.6], ["2", 1.86]));
  });

  it("has half-time / full-time of regular time, at both bookmakers", () => {
    expect(winamax.get("ht_ft")?.get("1/1")).toBe(2.25);
    expect(betclic.get("ht_ft")?.get("2/1")).toBe(6);
    for (const markets of [winamax, betclic]) expect(markets.get("ht_ft")?.size).toBe(9);
  });

  it("has a team winning both halves, or every quarter", () => {
    expect(winamax.get("win_both_halves@1")).toEqual(m(["yes", 3.35], ["no", 1.17]));
    expect(winamax.get("win_all_quarters@1")).toEqual(m(["yes", 16], ["no", 1.01]));
    // A "Non" priced 1 is left out, so no TRJ is made of the rest.
    expect(winamax.get("win_all_quarters@2")).toEqual(m(["yes", 22]));
  });

  it("has the quarter with the most points, a tie being the last outcome", () => {
    expect(betclic.get("highest_quarter")).toEqual(m(["q1", 3.04], ["q2", 3.23], ["q3", 4.25], ["q4", 3.76], ["tie", 12.25]));
  });
});

describe("a basketball match's halves", () => {
  it("have their result, with the draw, and the refund on it", () => {
    expect(winamax.get("ht_1X2")).toEqual(m(["1", 1.72], ["X", 14.5], ["2", 1.86]));
    expect(betclic.get("ht_1X2")).toEqual(m(["1", 1.76], ["X", 18.25], ["2", 1.93]));
    expect(winamax.get("ht_draw_no_bet")).toEqual(m(["1", 1.66], ["2", 1.8]));
    expect(betclic.get("ht_draw_no_bet")).toEqual(m(["1", 1.72], ["2", 1.89]));
  });

  it("have the second half's result at Betclic", () => {
    expect(betclic.get("2h_1X2")?.get("X")).toBe(18.25);
  });

  it("have a handicap and totals of their own", () => {
    expect(winamax.get("ht_spread|0.5")).toEqual(m(["1", 1.6], ["2", 1.86]));
    expect(betclic.get("ht_spread|-0.5")).toEqual(m(["1", 1.76], ["2", 1.78]));
    expect(winamax.get("ht_total_points|89.5")).toEqual(m(["over", 1.82], ["under", 1.62]));
    expect(betclic.get("ht_total_points|87.5")).toEqual(m(["over", 1.69], ["under", 1.83]));
    expect(betclic.get("2h_total_points|84.5")).toEqual(m(["over", 1.7], ["under", 1.81]));
    expect(winamax.get("ht_team_points@1|45.5")).toEqual(m(["over", 1.9], ["under", 1.56]));
  });
});

describe("a basketball match's quarters", () => {
  it("have their result, with the draw, and the refund on it", () => {
    expect(winamax.get("q1_1X2")).toEqual(m(["1", 1.76], ["X", 11.5], ["2", 1.86]));
    expect(betclic.get("q1_1X2")).toEqual(m(["1", 1.81], ["X", 13.5], ["2", 1.92]));
    expect(winamax.get("q1_draw_no_bet")).toEqual(m(["1", 1.68], ["2", 1.78]));
    expect(betclic.get("q1_draw_no_bet")).toEqual(m(["1", 1.72], ["2", 1.83]));
  });

  it("have a handicap and totals of their own, the quarter in the key", () => {
    expect(winamax.get("q1_spread|0.5")).toEqual(m(["1", 1.6], ["2", 1.86]));
    expect(betclic.get("q1_spread|-0.5")).toEqual(m(["1", 1.81], ["2", 1.73]));
    expect(winamax.get("q1_total_points|42.5")).toEqual(m(["over", 1.46], ["under", 2]));
    expect(betclic.get("q1_total_points|42.5")).toEqual(m(["over", 1.52], ["under", 2.07]));
    expect(winamax.get("q1_team_points@1|22.5")).toEqual(m(["over", 1.78], ["under", 1.68]));
    expect(winamax.get("q1_team_points@2|22.5")).toEqual(m(["over", 1.86], ["under", 1.6]));
    expect(betclic.get("q1_team_points@1|21.5")).toEqual(m(["over", 1.6], ["under", 1.94]));
  });

  it("are the second, third and fourth ones' too, where a bookmaker lists them", () => {
    expect(betclic.get("q4_total_points|42.5")).toEqual(m(["over", 1.74], ["under", 1.77]));
  });
});

describe("a basketball match's players", () => {
  // A market a player and line, over and under: Winamax gives it so; a ladder
  // ("20 points or more", Winamax's "paliers", Betclic's) is the over of N - 0.5.
  it("are over and under a line of a statistic, at Winamax", () => {
    expect(winamax.get("player_points#Aleksander Balcerowski|8.5")).toEqual(m(["over", 2], ["under", 1.5]));
    expect(winamax.get("player_assists#Justin Robinson|3.5")).toEqual(m(["over", 1.5], ["under", 2]));
    expect(winamax.get("player_rebounds#Joel Parra|3.5")).toEqual(m(["over", 1.96], ["under", 1.54]));
    expect(winamax.get("player_threes#Kevin Punter|1.5")).toEqual(m(["over", 1.44], ["under", 2.1]));
    // Points + rebonds + passes, points + passes, passes + rebonds, points + rebonds.
    expect(winamax.get("player_pra#Justin Robinson|15.5")).toEqual(m(["over", 1.5], ["under", 2]));
    expect(winamax.get("player_pa#Justin Robinson|14.5")).toEqual(m(["over", 1.64], ["under", 1.8]));
    expect(winamax.get("player_ra#Justin Robinson|5.5")).toEqual(m(["over", 1.5], ["under", 2]));
    expect(winamax.get("player_pr#Joel Parra|10.5")).toEqual(m(["over", 1.56], ["under", 1.92]));
  });

  it("have ladders, the over of each of their lines, at both bookmakers", () => {
    // Kevin Punter, 20 points or more: two prices of one bet.
    expect(winamax.get("player_points#Kevin Punter|19.5")).toEqual(m(["over", 2.5]));
    expect(betclic.get("player_points#Kevin Punter|19.5")).toEqual(m(["over", 2.17]));
    // Betclic's ladder has a card a player, a line every five points.
    expect(betclic.get("player_points#Kevin Punter|9.5")).toEqual(m(["over", 1.08]));
    expect(betclic.get("player_points#Kevin Punter|14.5")).toEqual(m(["over", 1.37]));
    expect(betclic.get("player_points#Kevin Punter|29.5")).toEqual(m(["over", 6.4]));
    expect(winamax.get("player_threes#Kevin Punter|0.5")).toEqual(m(["over", 1.06]));
    expect(winamax.get("player_assists#Justin Robinson|2.5")).toEqual(m(["over", 1.18]));
    expect(betclic.get("player_rebounds#Jonas Valanciunas|9.5")).toEqual(m(["over", 5.9]));
  });

  it("are over and under at Betclic, who names them its own way", () => {
    expect(betclic.get("player_points#Aleksander Balcerowski|9.5")).toEqual(m(["over", 1.75], ["under", 1.75]));
    expect(betclic.get("player_pr#Aleksander Balcerowski|12.5")).toEqual(m(["over", 1.65], ["under", 1.83]));
    expect(betclic.get("player_pa#Azuolas Tubelis|16.5")).toEqual(m(["over", 1.65], ["under", 1.83]));
    expect(betclic.get("player_ra#Azuolas Tubelis|9.5")).toEqual(m(["over", 1.69], ["under", 1.79]));
  });

  it("have the best scorer and the double-double, by player, at both bookmakers", () => {
    expect(winamax.get("top_scorer")?.get("Carsen Edwards")).toBe(2.95);
    expect(winamax.get("top_scorer")?.size).toBe(12);
    expect(betclic.get("top_scorer")?.get("Kevin Punter")).toBe(2.68);
    expect(winamax.get("double_double")).toEqual(m(["Azuolas Tubelis", 5.4], ["Justin Robinson", 30]));
    expect(betclic.get("double_double")).toEqual(m(["Azuolas Tubelis", 7.75]));
  });

  it("leave out a line of a whole number, and keep what no family covers under Winamax's and Betclic's names", () => {
    for (const markets of [winamax, betclic]) {
      for (const key of markets.keys()) {
        const parsed = parseMarketKey(key);
        if (parsed.kind === "family" && parsed.family.perPlayer) expect(Number.isInteger(parsed.line), key).toBe(false);
      }
    }
    // The pairs of players, the head-to-heads between two: Winamax's own.
    expect([...winamax.keys()].some((k) => k.startsWith("wx:Duo marqueurs de points"))).toBe(true);
    expect([...betclic.keys()].some((k) => k.startsWith("bc:Le duo inscrit 40 points ou +"))).toBe(true);
  });
});

describe("basketball's families at the two bookmakers", () => {
  const found = (markets: Map<string, Map<string, number>>) => {
    const keys = new Set<string>();
    for (const key of markets.keys()) {
      const parsed = parseMarketKey(key);
      if (parsed.kind === "family") keys.add(parsed.family.key);
    }
    return keys;
  };
  const bookmakers = { winamax: found(winamax), betclic: found(betclic) };
  const offering = (family: string) => Object.entries(bookmakers).filter(([, f]) => f.has(family)).map(([b]) => b);

  it("are only the catalog's, read at one of them at least for the main ones", () => {
    const families = new Set(familiesOf("basketball").map((f) => f.key));
    for (const keys of Object.values(bookmakers)) for (const key of keys) expect(families.has(key), key).toBe(true);
    expect(offering("1X2")).toEqual(["winamax", "betclic"]);
    expect(offering("total_points")).toEqual(["winamax", "betclic"]);
    expect(offering("spread")).toEqual(["winamax", "betclic"]);
  });
});

describe("a sport a bookmaker has no markets table for", () => {
  it("reads nothing at Winamax, whose ids mean other things from a sport to another", () => {
    const reply = winamaxReply();
    reply.matches![WINAMAX_ID] = { ...reply.matches![WINAMAX_ID], sportId: 4 };
    expect(readWinamaxMarkets(reply, WINAMAX_ID)).toEqual([]);
  });
});
