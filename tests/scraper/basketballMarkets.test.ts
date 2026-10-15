import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { readWinamaxMarkets, WinamaxMatchReply } from "../../src/scraper/winamaxMarkets";
import { readBetclicMarkets, readBetclicMatchPage } from "../../src/scraper/betclicMarkets";
import { readUnibetMarkets } from "../../src/scraper/unibetMarkets";
import { UnibetPage } from "../../src/scraper/unibet";
import { readVbetMarkets, VbetReply } from "../../src/scraper/vbet";
import { readBetssonEventMarkets } from "../../src/scraper/betssonMarkets";
import { readNetbetMarkets } from "../../src/scraper/sportncoMarkets";
import { familiesOf, parseMarketKey } from "../../src/markets/catalog";
import { RawOdds } from "../../src/types";

// Barcelone - Zalgiris Kaunas (Euroleague), 9 October 2026 at 18:30 UTC, at
// each of the six bookmakers: their own replies, captured that day (Winamax's
// "match:<id>", Betclic's default page and tabs, Unibet's "ff" route, Vbet's
// Swarm "get", Betsson's "event", NetBet's "event_market_list").
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
const UNIBET_ID = "e3375682";
const unibetPage = (): UnibetPage => json("unibet-basketball-markets.json.gz");
const VBET_ID = "31016912";
const vbetReply = (): VbetReply => json("vbet-BasketballMarkets.json.gz");

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
const unibet = grid(readUnibetMarkets(unibetPage(), UNIBET_ID));
const vbet = grid(readVbetMarkets(vbetReply()).get(VBET_ID)!);
const betsson = grid(readBetssonEventMarkets(json("betsson-event-basketball.json.gz")));
const netbet = grid(readNetbetMarkets(json("sportnco-netbet-event-basketball.json.gz")));

describe("a basketball match's result in regular time", () => {
  // A draw is possible there (12 to 17 for it), the match going to overtime
  // when it is level: the 1X2 of the catalog, at each bookmaker.
  it("is read at all six bookmakers, in their own team order", () => {
    expect(winamax.get("1X2")).toEqual(new Map([["1", 1.8], ["X", 12.5], ["2", 2.05]]));
    expect(betclic.get("1X2")).toEqual(new Map([["1", 1.82], ["X", 12.75], ["2", 2.12]]));
    expect(unibet.get("1X2")).toEqual(new Map([["1", 1.77], ["X", 12], ["2", 2.05]]));
    expect(vbet.get("1X2")).toEqual(new Map([["1", 1.65], ["X", 10], ["2", 1.9]]));
    expect(betsson.get("1X2")).toEqual(new Map([["1", 1.78], ["X", 12.5], ["2", 2.09]]));
    expect(netbet.get("1X2")).toEqual(new Map([["1", 1.78], ["X", 12], ["2", 2.12]]));
  });

  it("is not the winner of the match, overtime included, which five bookmakers list on their own", () => {
    for (const markets of [winamax, betclic, vbet, betsson, netbet]) expect(markets.has("Vainqueur du match")).toBe(false);
  });
});

describe("a basketball match's winner at Unibet", () => {
  // Unibet's list gives its result in regular time only; its winner, overtime
  // included ("Face à Face", the period "Match"), is in the match's markets.
  it("is read from the match's markets: its listing has the result in regular time", () => {
    expect(unibet.get("Vainqueur du match")).toEqual(new Map([["1", 1.69], ["2", 1.94]]));
  });
});

const m = (...entries: [string, number][]) => new Map(entries);

describe("a basketball match's handicap", () => {
  // The first team's line, whichever side a bookmaker writes: Barcelone -6.5 is
  // "1" at -6.5, Zalgiris +6.5 "2". The match's own handicaps are overtime included.
  it("is read as the first team's line at five bookmakers, whose prices agree", () => {
    expect(winamax.get("spread|-6.5")).toEqual(m(["1", 2.45], ["2", 1.33]));
    expect(betclic.get("spread|-6.5")).toEqual(m(["1", 2.61], ["2", 1.38]));
    expect(betsson.get("spread|-6.5")).toEqual(m(["1", 2.48], ["2", 1.36]));
    expect(netbet.get("spread|-6.5")).toEqual(m(["1", 2.37], ["2", 1.27]));
    expect(vbet.get("spread|-2.5")).toEqual(m(["1", 1.78], ["2", 1.63]));
    // The second team's line is the first's, changed in sign.
    expect(winamax.get("spread|9.5")).toEqual(m(["1", 1.12], ["2", 4]));
  });

  it("is Betclic's margin: \"gagne de 7 ou +\" is -6.5, \"ne perd pas ou perd de 6 ou -\" +6.5", () => {
    expect([...betclic.keys()].filter((k) => k.startsWith("spread|")).sort()).toHaveLength(21);
    // Both sides of every line, so each has a TRJ.
    for (const [key, prices] of betclic) if (key.startsWith("spread|")) expect([...prices.keys()].sort()).toEqual(["1", "2"]);
  });

  it("is left out of a Euroleague match at Unibet, whose handicaps are in regular time", () => {
    expect([...unibet.keys()].some((k) => k.startsWith("spread|"))).toBe(false);
    expect([...unibet.keys()].some((k) => k.startsWith("ht_spread|"))).toBe(true);
  });

  it("is read at Unibet when the period is the whole match, as in a WNBA match", () => {
    const wnba = grid(readUnibetMarkets(json("unibet-basketball-wnba-markets.json.gz") as UnibetPage, "e3385274"));
    expect(wnba.get("spread|-13.5")).toEqual(m(["1", 4], ["2", 1.1]));
    expect([...wnba.keys()].filter((k) => k.startsWith("spread|"))).toHaveLength(21);
  });
});

describe("a basketball match's totals", () => {
  it("are over and under a line of half a point, at all six bookmakers", () => {
    expect(winamax.get("total_points|174.5")).toEqual(m(["over", 1.76], ["under", 1.7]));
    expect(betclic.get("total_points|174.5")).toEqual(m(["over", 1.76], ["under", 1.82]));
    expect(unibet.get("total_points|174.5")).toEqual(m(["over", 1.72], ["under", 1.72]));
    expect(vbet.get("total_points|175.5")).toEqual(m(["over", 1.84], ["under", 1.58]));
    expect(betsson.get("total_points|171.5")).toEqual(m(["over", 1.56], ["under", 2.01]));
    expect(netbet.get("total_points|169.5")).toEqual(m(["over", 1.37], ["under", 2.1]));
  });

  it("are read for each team, the first team's being \"@1\"", () => {
    expect(winamax.get("team_points@1|87.5")).toEqual(m(["over", 1.72], ["under", 1.74]));
    expect(winamax.get("team_points@2|84.5")).toEqual(m(["over", 1.5], ["under", 2]));
    expect(betclic.get("team_points@1|87.5")).toEqual(m(["over", 1.77], ["under", 1.86]));
    expect(unibet.get("team_points@2|85.5")).toEqual(m(["over", 1.6], ["under", 1.9]));
    expect(vbet.get("team_points@1|87.5")).toEqual(m(["over", 1.6], ["under", 1.7]));
    expect(vbet.get("team_points@2|85.5")).toEqual(m(["over", 1.55], ["under", 1.8]));
    expect(betsson.get("team_points@2|84.5")).toEqual(m(["over", 1.53], ["under", 2.1]));
    expect(netbet.get("team_points@1|88.5")).toEqual(m(["over", 1.65], ["under", 1.65]));
  });

  it("leave out a line of a whole number, which refunds a push", () => {
    // Vbet's first-half totals of 87, 88 and 89 points, and the half ones.
    expect([...vbet.keys()].filter((k) => k.startsWith("ht_total_points|")).every((k) => k.endsWith(".5"))).toBe(true);
    expect([...vbet.keys()].filter((k) => k.startsWith("ht_total_points|"))).toHaveLength(2);
    for (const markets of [winamax, betclic, unibet, vbet, betsson, netbet]) {
      for (const key of markets.keys()) {
        const parsed = parseMarketKey(key);
        if (parsed.kind === "family" && parsed.line !== undefined) expect(Number.isInteger(parsed.line), key).toBe(false);
      }
    }
  });

  it("are combined with the winner, overtime included, at five bookmakers", () => {
    expect(winamax.get("winner_total|174.5")).toEqual(m(["1&under", 2.75], ["1&over", 2.95], ["2&under", 3.25], ["2&over", 3.4]));
    expect(betclic.get("winner_total|174.5")).toEqual(m(["1&over", 3.06], ["1&under", 3.06], ["2&over", 3.53], ["2&under", 3.53]));
    expect(unibet.get("winner_total|174.5")).toEqual(m(["1&over", 2.85], ["2&over", 3.3], ["1&under", 2.9], ["2&under", 3.3]));
    expect(vbet.get("winner_total|175.5")).toEqual(m(["1&over", 2.64], ["1&under", 2.64], ["2&over", 2.94], ["2&under", 2.94]));
    expect(betsson.get("winner_total|174.5")).toEqual(m(["1&under", 2.97], ["2&under", 3.45], ["1&over", 2.96], ["2&over", 3.45]));
    // NetBet lists no such market.
    expect([...netbet.keys()].some((k) => k.startsWith("winner_total|"))).toBe(false);
  });
});

describe("a basketball match's other markets", () => {
  it("has an overtime that four bookmakers price, a price of 1 being no price", () => {
    expect(winamax.get("overtime")).toEqual(m(["yes", 10], ["no", 1.02]));
    expect(betclic.get("overtime")).toEqual(m(["yes", 12.75], ["no", 1.03]));
    expect(unibet.get("overtime")).toEqual(m(["yes", 6], ["no", 1.03]));
    // NetBet's "Non" at 1.
    expect(netbet.get("overtime")).toEqual(m(["yes", 8]));
  });

  it("has the refund on a draw, in regular time", () => {
    expect(winamax.get("draw_no_bet")).toEqual(m(["1", 1.6], ["2", 1.86]));
    expect(betsson.get("draw_no_bet")).toEqual(m(["1", 1.64], ["2", 1.92]));
    const wnba = grid(readUnibetMarkets(json("unibet-basketball-wnba-markets.json.gz") as UnibetPage, "e3385274"));
    expect(wnba.get("draw_no_bet")).toEqual(m(["1", 1.57], ["2", 2.15]));
  });

  it("has half-time / full-time of regular time, at five bookmakers", () => {
    expect(winamax.get("ht_ft")?.get("1/1")).toBe(2.25);
    expect(betclic.get("ht_ft")?.get("2/1")).toBe(6);
    expect(unibet.get("ht_ft")?.get("X/2")).toBe(36);
    expect(vbet.get("ht_ft")?.get("2/1")).toBe(5.1);
    expect(betsson.get("ht_ft")?.get("2/2")).toBe(2.34);
    // Winamax, Betclic, Unibet and Betsson give the nine; Vbet lists six of them.
    for (const markets of [winamax, betclic, unibet, betsson]) expect(markets.get("ht_ft")?.size).toBe(9);
    expect(vbet.get("ht_ft")?.size).toBe(6);
    // NetBet's, overtime included, has no draw: not this market.
    expect([...netbet.keys()]).not.toContain("ht_ft");
  });

  it("has a team winning both halves, or every quarter", () => {
    expect(winamax.get("win_both_halves@1")).toEqual(m(["yes", 3.35], ["no", 1.17]));
    expect(unibet.get("win_both_halves@1")).toEqual(m(["yes", 3], ["no", 1.18]));
    expect(vbet.get("win_both_halves@2")).toEqual(m(["yes", 3.25], ["no", 1.11]));
    expect(betsson.get("win_both_halves@1")).toEqual(m(["yes", 2.9], ["no", 1.17]));
    expect(winamax.get("win_all_quarters@1")).toEqual(m(["yes", 16], ["no", 1.01]));
    expect(betsson.get("win_all_quarters@1")).toEqual(m(["yes", 5.95], ["no", 1.01]));
    // A "Non" priced 1 (Winamax's, Unibet's) is left out, so no TRJ is made of the rest.
    expect(winamax.get("win_all_quarters@2")).toEqual(m(["yes", 22]));
    expect(unibet.get("win_all_quarters@1")).toEqual(m(["yes", 6.5]));
  });

  it("has the quarter with the most points, a tie being the last outcome, at five bookmakers", () => {
    expect(betclic.get("highest_quarter")).toEqual(m(["q1", 3.04], ["q2", 3.23], ["q3", 4.25], ["q4", 3.76], ["tie", 12.25]));
    expect(unibet.get("highest_quarter")).toEqual(m(["q1", 2.7], ["q2", 2.85], ["q3", 3.7], ["q4", 3.25], ["tie", 10]));
    expect(vbet.get("highest_quarter")).toEqual(m(["q1", 2.94], ["q2", 2.87], ["q3", 3.74], ["q4", 2.39], ["tie", 8.6]));
    expect(betsson.get("highest_quarter")).toEqual(m(["q1", 3.15], ["q2", 3.35], ["q3", 4.45], ["q4", 3.9], ["tie", 12.5]));
    expect(netbet.get("highest_quarter")).toEqual(m(["q1", 3], ["q2", 2.92], ["tie", 10.5], ["q4", 2.37], ["q3", 3.95]));
  });

  it("has the half with the most points at Vbet and NetBet", () => {
    expect(vbet.get("highest_half")).toEqual(m(["2nd", 1.69], ["1st", 1.64], ["tie", 21]));
    expect(netbet.get("highest_half")).toEqual(m(["1st", 1.65], ["2nd", 1.7], ["tie", 24]));
  });
});

describe("a basketball match's halves", () => {
  it("have their result, with the draw, and the refund on it", () => {
    expect(winamax.get("ht_1X2")).toEqual(m(["1", 1.72], ["X", 14.5], ["2", 1.86]));
    expect(betclic.get("ht_1X2")).toEqual(m(["1", 1.76], ["X", 18.25], ["2", 1.93]));
    expect(unibet.get("ht_1X2")).toEqual(m(["1", 1.71], ["X", 17], ["2", 1.86]));
    expect(vbet.get("ht_1X2")).toEqual(m(["1", 1.63], ["X", 12], ["2", 1.81]));
    expect(betsson.get("ht_1X2")).toEqual(m(["1", 1.7], ["X", 17], ["2", 1.87]));
    expect(netbet.get("ht_1X2")).toEqual(m(["1", 1.63], ["X", 14.5], ["2", 1.82]));
    expect(winamax.get("ht_draw_no_bet")).toEqual(m(["1", 1.66], ["2", 1.8]));
    expect(betclic.get("ht_draw_no_bet")).toEqual(m(["1", 1.72], ["2", 1.89]));
    expect(unibet.get("ht_draw_no_bet")).toEqual(m(["1", 1.65], ["2", 1.8]));
    expect(vbet.get("ht_draw_no_bet")).toEqual(m(["1", 1.57], ["2", 1.75]));
    expect(betsson.get("ht_draw_no_bet")).toEqual(m(["1", 1.62], ["2", 1.78]));
    expect(netbet.get("ht_draw_no_bet")).toEqual(m(["1", 1.58], ["2", 1.77]));
  });

  it("have the second half's result at four bookmakers", () => {
    expect(betclic.get("2h_1X2")?.get("X")).toBe(18.25);
    expect(unibet.get("2h_1X2")?.get("X")).toBe(17);
    expect(betsson.get("2h_1X2")?.get("1")).toBe(1.71);
    expect(netbet.get("2h_1X2")).toEqual(m(["1", 1.65], ["X", 14.5], ["2", 1.78]));
  });

  it("have a handicap and totals of their own", () => {
    expect(winamax.get("ht_spread|0.5")).toEqual(m(["1", 1.6], ["2", 1.86]));
    expect(betclic.get("ht_spread|-0.5")).toEqual(m(["1", 1.76], ["2", 1.78]));
    expect(unibet.get("ht_spread|-0.5")).toEqual(m(["1", 1.72], ["2", 1.72]));
    expect(vbet.get("ht_spread|-1.5")).toEqual(m(["1", 1.68], ["2", 1.52]));
    expect(betsson.get("ht_spread|-2.5")).toEqual(m(["1", 2.06], ["2", 1.55]));
    expect(netbet.get("ht_spread|-0.5")).toEqual(m(["1", 1.65], ["2", 1.68]));
    expect(winamax.get("ht_total_points|89.5")).toEqual(m(["over", 1.82], ["under", 1.62]));
    expect(betclic.get("ht_total_points|87.5")).toEqual(m(["over", 1.69], ["under", 1.83]));
    expect(betclic.get("2h_total_points|84.5")).toEqual(m(["over", 1.7], ["under", 1.81]));
    expect(unibet.get("ht_total_points|87.5")).toEqual(m(["over", 1.65], ["under", 1.8]));
    expect(vbet.get("ht_total_points|87.5")).toEqual(m(["over", 1.6], ["under", 1.6]));
    expect(betsson.get("2h_total_points|82.5")).toEqual(m(["over", 1.53], ["under", 2.09]));
    expect(netbet.get("ht_total_points|87.5")).toEqual(m(["over", 1.68], ["under", 1.63]));
    expect(winamax.get("ht_team_points@1|45.5")).toEqual(m(["over", 1.9], ["under", 1.56]));
    expect(unibet.get("ht_team_points@2|42.5")).toEqual(m(["over", 1.55], ["under", 1.95]));
    expect(vbet.get("ht_team_points@1|43.5")).toEqual(m(["over", 1.52], ["under", 1.68]));
    expect(netbet.get("ht_team_points@2|43.5")).toEqual(m(["over", 1.63], ["under", 1.7]));
  });
});

describe("a basketball match's quarters", () => {
  it("have their result, with the draw, and the refund on it", () => {
    expect(winamax.get("q1_1X2")).toEqual(m(["1", 1.76], ["X", 11.5], ["2", 1.86]));
    expect(betclic.get("q1_1X2")).toEqual(m(["1", 1.81], ["X", 13.5], ["2", 1.92]));
    expect(unibet.get("q1_1X2")).toEqual(m(["1", 1.79], ["X", 13.5], ["2", 1.9]));
    expect(betsson.get("q1_1X2")).toEqual(m(["1", 1.82], ["X", 14], ["2", 1.95]));
    expect(netbet.get("q1_1X2")).toEqual(m(["1", 1.68], ["X", 11.5], ["2", 1.82]));
    expect(winamax.get("q1_draw_no_bet")).toEqual(m(["1", 1.68], ["2", 1.78]));
    expect(betclic.get("q1_draw_no_bet")).toEqual(m(["1", 1.72], ["2", 1.83]));
    expect(unibet.get("q1_draw_no_bet")).toEqual(m(["1", 1.7], ["2", 1.8]));
    expect(betsson.get("q1_draw_no_bet")).toEqual(m(["1", 1.64], ["2", 1.75]));
  });

  it("have a handicap and totals of their own, the quarter in the key", () => {
    expect(winamax.get("q1_spread|0.5")).toEqual(m(["1", 1.6], ["2", 1.86]));
    expect(betclic.get("q1_spread|-0.5")).toEqual(m(["1", 1.81], ["2", 1.73]));
    expect(unibet.get("q1_spread|-2.5")).toEqual(m(["1", 2.2], ["2", 1.42]));
    expect(vbet.get("q1_spread|-0.5")).toEqual(m(["1", 1.6], ["2", 1.6]));
    expect(betsson.get("q1_spread|-2.5")).toEqual(m(["1", 2.22], ["2", 1.45]));
    expect(netbet.get("q1_spread|-0.5")).toEqual(m(["1", 1.7], ["2", 1.7]));
    expect(winamax.get("q1_total_points|42.5")).toEqual(m(["over", 1.46], ["under", 2]));
    expect(betclic.get("q1_total_points|42.5")).toEqual(m(["over", 1.52], ["under", 2.07]));
    expect(unibet.get("q1_total_points|44.5")).toEqual(m(["over", 1.8], ["under", 1.65]));
    expect(vbet.get("q1_total_points|43.5")).toEqual(m(["over", 1.58], ["under", 1.62]));
    expect(betsson.get("q1_total_points|42.5")).toEqual(m(["over", 1.52], ["under", 2.07]));
    expect(netbet.get("q1_total_points|43.5")).toEqual(m(["over", 1.61], ["under", 1.71]));
    expect(winamax.get("q1_team_points@1|22.5")).toEqual(m(["over", 1.78], ["under", 1.68]));
    expect(winamax.get("q1_team_points@2|22.5")).toEqual(m(["over", 1.86], ["under", 1.6]));
    expect(betclic.get("q1_team_points@1|21.5")).toEqual(m(["over", 1.6], ["under", 1.94]));
    expect(unibet.get("q1_team_points@2|19.5")).toEqual(m(["over", 1.3], ["under", 2.55]));
    expect(vbet.get("q1_team_points@1|22.5")).toEqual(m(["over", 1.68], ["under", 1.52]));
    expect(betsson.get("q1_team_points@2|20.5")).toEqual(m(["over", 1.46], ["under", 2.16]));
    expect(netbet.get("q1_team_points@1|22.5")).toEqual(m(["over", 1.75], ["under", 1.58]));
  });

  it("are the second, third and fourth ones' too, where a bookmaker lists them", () => {
    expect(betclic.get("q4_total_points|42.5")).toEqual(m(["over", 1.74], ["under", 1.77]));
    expect(unibet.get("q2_total_points|43.5")).toEqual(m(["over", 1.72], ["under", 1.72]));
    expect(netbet.get("q2_1X2")).toEqual(m(["1", 1.68], ["X", 13], ["2", 1.78]));
    expect(betsson.get("q3_1X2")?.size).toBe(3);
    expect(betsson.get("q4_total_points|40.5")).toBeDefined();
    expect(netbet.get("q2_team_points@1|22.5")).toEqual(m(["over", 1.77], ["under", 1.57]));
  });
});

describe("a basketball match's players", () => {
  // A market a player and line, over and under: Winamax, Unibet, Betsson and
  // NetBet give it so; a ladder ("20 points or more", Winamax's "paliers",
  // Betclic's, Unibet's, Vbet's, Betsson's) is the over of N - 0.5.
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

  it("have ladders, the over of each of their lines, at Winamax, Betclic, Unibet, Vbet and Betsson", () => {
    // Kevin Punter, 20 points or more: five bookmakers, five prices of one bet.
    expect(winamax.get("player_points#Kevin Punter|19.5")).toEqual(m(["over", 2.5]));
    expect(betclic.get("player_points#Kevin Punter|19.5")).toEqual(m(["over", 2.17]));
    expect(unibet.get("player_points#Kevin Punter|19.5")).toEqual(m(["over", 2.1]));
    expect(vbet.get("player_points#Kevin Punter|19.5")).toEqual(m(["over", 2.15]));
    expect(betsson.get("player_points#Kevin Punter|19.5")).toEqual(m(["over", 2.04]));
    // Betclic's ladder has a card a player, a line every five points.
    expect(betclic.get("player_points#Kevin Punter|9.5")).toEqual(m(["over", 1.08]));
    expect(betclic.get("player_points#Kevin Punter|14.5")).toEqual(m(["over", 1.37]));
    expect(betclic.get("player_points#Kevin Punter|29.5")).toEqual(m(["over", 6.4]));
    // Unibet's "Marius Grigonis 18+" is the over of 17.5.
    expect(unibet.get("player_points#Marius Grigonis|17.5")).toEqual(m(["over", 18]));
    expect(winamax.get("player_threes#Kevin Punter|0.5")).toEqual(m(["over", 1.06]));
    expect(winamax.get("player_assists#Justin Robinson|2.5")).toEqual(m(["over", 1.18]));
    expect(unibet.get("player_assists#Maodo Lo|6.5")).toEqual(m(["over", 7.8]));
    expect(unibet.get("player_threes#Justin Robinson|5.5")).toEqual(m(["over", 20]));
    expect(betclic.get("player_rebounds#Jonas Valanciunas|9.5")).toEqual(m(["over", 5.9]));
    expect(vbet.get("player_rebounds#Jonas Valanciunas|9.5")).toEqual(m(["over", 3.5]));
    expect(vbet.get("player_assists#Justin Robinson|2.5")).toEqual(m(["over", 1.17]));
    expect(vbet.get("player_threes#Sterling Brown|0.5")).toEqual(m(["over", 1.04]));
    expect(betsson.get("player_assists#Azuolas Tubelis|1.5")).toEqual(m(["over", 1.1]));
    expect(betsson.get("player_threes#Joel Parra|1.5")).toEqual(m(["over", 2.24]));
  });

  it("are over and under at Betclic, Unibet, Betsson and NetBet, who name them their own way", () => {
    expect(betclic.get("player_points#Aleksander Balcerowski|9.5")).toEqual(m(["over", 1.75], ["under", 1.75]));
    expect(betclic.get("player_pr#Aleksander Balcerowski|12.5")).toEqual(m(["over", 1.65], ["under", 1.83]));
    expect(betclic.get("player_pa#Azuolas Tubelis|16.5")).toEqual(m(["over", 1.65], ["under", 1.83]));
    expect(betclic.get("player_ra#Azuolas Tubelis|9.5")).toEqual(m(["over", 1.69], ["under", 1.79]));
    expect(unibet.get("player_points#Edgaras Ulanovas|4.5")).toEqual(m(["over", 1.72], ["under", 1.72]));
    expect(unibet.get("player_rebounds#Sterling Brown|1.5")).toEqual(m(["over", 1.55], ["under", 1.95]));
    expect(unibet.get("player_assists#Sterling Brown|1.5")).toEqual(m(["over", 2.1], ["under", 1.45]));
    expect(unibet.get("player_pr#Aleksander Balcerowski|12.5")).toEqual(m(["over", 1.65], ["under", 1.85]));
    // Betsson writes "Ulanovas, Edgaras" in its titles and ladders.
    expect(betsson.get("player_points#Edgaras Ulanovas|4.5")).toEqual(m(["over", 1.67], ["under", 1.69]));
    expect(betsson.get("player_assists#Dario Brizuela|1.5")).toEqual(m(["over", 1.85], ["under", 1.51]));
    expect(betsson.get("player_rebounds#Justin Robinson|1.5")).toEqual(m(["over", 1.62], ["under", 1.72]));
    expect(netbet.get("player_points#Azuolas Tubelis|13.5")).toEqual(m(["over", 1.73], ["under", 1.68]));
    expect(netbet.get("player_assists#Azuolas Tubelis|2.5")).toEqual(m(["over", 2], ["under", 1.48]));
    expect(netbet.get("player_rebounds#Joel Parra|3.5")).toEqual(m(["over", 1.75], ["under", 1.65]));
  });

  it("price one line at several bookmakers: Jonas Valanciunas' rebounds", () => {
    const line = "player_rebounds#Jonas Valanciunas|6.5";
    expect(winamax.get(line)).toEqual(m(["over", 1.58], ["under", 1.9]));
    expect(unibet.get(line)).toEqual(m(["over", 1.65], ["under", 1.8]));
    expect(betsson.get(line)).toEqual(m(["over", 1.63], ["under", 1.71]));
    expect(netbet.get(line)).toEqual(m(["over", 1.65], ["under", 1.75]));
    expect(vbet.get(line)).toEqual(m(["over", 1.51]));
  });

  it("have the best scorer and the double-double, by player, at the bookmakers that list them", () => {
    expect(winamax.get("top_scorer")?.get("Carsen Edwards")).toBe(2.95);
    expect(winamax.get("top_scorer")?.size).toBe(12);
    expect(betclic.get("top_scorer")?.get("Kevin Punter")).toBe(2.68);
    expect(unibet.get("top_scorer")?.get("Kevin Punter")).toBe(2.7);
    expect(vbet.get("top_scorer")?.get("Carsen Edwards")).toBe(2.67);
    expect(winamax.get("double_double")).toEqual(m(["Azuolas Tubelis", 5.4], ["Justin Robinson", 30]));
    expect(betclic.get("double_double")).toEqual(m(["Azuolas Tubelis", 7.75]));
  });

  it("leave out a line of a whole number, and keep what no family covers under Winamax's and Betclic's names", () => {
    for (const markets of [winamax, betclic, unibet, vbet, betsson, netbet]) {
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

describe("basketball's families across the six bookmakers", () => {
  const found = (markets: Map<string, Map<string, number>>) => {
    const keys = new Set<string>();
    for (const key of markets.keys()) {
      const parsed = parseMarketKey(key);
      if (parsed.kind === "family") keys.add(parsed.family.key);
    }
    return keys;
  };
  const wnba = grid(readUnibetMarkets(json("unibet-basketball-wnba-markets.json.gz") as UnibetPage, "e3385274"));
  const bookmakers = { winamax: found(winamax), betclic: found(betclic), unibet: new Set([...found(unibet), ...found(wnba)]), vbet: found(vbet), betsson: found(betsson), netbet: found(netbet) };
  const offering = (family: string) => Object.entries(bookmakers).filter(([, f]) => f.has(family)).map(([b]) => b);

  it("are read at two bookmakers at least, but those no capture of these two matches shows", () => {
    // A third, fourth quarter's team totals and the second half's: no bookmaker lists them for these matches.
    const unseen = new Set(["2h_team_points@1", "2h_team_points@2", "q3_team_points@1", "q3_team_points@2", "q4_team_points@1", "q4_team_points@2"]);
    const lonely = familiesOf("basketball")
      .map((f) => f.key)
      .filter((key) => !unseen.has(key) && offering(key).length < 2);
    // The second quarter's team totals are NetBet's alone here.
    expect(lonely).toEqual(["q2_team_points@1", "q2_team_points@2"]);
    expect(offering("1X2")).toHaveLength(6);
    expect(offering("total_points")).toHaveLength(6);
    expect(offering("q1_team_points@2")).toHaveLength(6);
    expect(offering("spread")).toEqual(expect.arrayContaining(["winamax", "betclic", "vbet", "betsson", "netbet", "unibet"]));
  });

  it("are only the catalog's, not a bookmaker's own name for a market, but for Winamax's and Betclic's", () => {
    for (const markets of [unibet, vbet, betsson, netbet]) {
      expect([...markets.keys()].filter((k) => parseMarketKey(k).kind !== "family")).toEqual(
        // The winner, overtime included, is Unibet's: the listing's key.
        markets === unibet ? ["Vainqueur du match"] : []
      );
    }
  });
});

describe("a WNBA match at Unibet", () => {
  // Beside its winner (the period "Match") Unibet lists a two-way "Face à Face"
  // in regular time, which is not the winner, overtime included.
  it("reads the winner from the period \"Match\", not from the two-way market in regular time", () => {
    const wnba = grid(readUnibetMarkets(json("unibet-basketball-wnba-markets.json.gz") as UnibetPage, "e3385274"));
    expect(wnba.get("Vainqueur du match")).toEqual(new Map([["1", 1.56], ["2", 2.1]]));
    expect(wnba.get("1X2")).toEqual(new Map([["1", 1.65], ["X", 12], ["2", 2.25]]));
  });
});

describe("a sport a bookmaker has no markets table for", () => {
  it("reads nothing at Winamax, whose ids mean other things from a sport to another", () => {
    const reply = winamaxReply();
    reply.matches![WINAMAX_ID] = { ...reply.matches![WINAMAX_ID], sportId: 4 };
    expect(readWinamaxMarkets(reply, WINAMAX_ID)).toEqual([]);
  });
});
