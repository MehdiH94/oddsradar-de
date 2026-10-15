import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { readWinamaxMarkets, WinamaxMatchReply } from "../../src/scraper/winamaxMarkets";
import { BetclicMatchPage, readBetclicMatchPage, readBetclicMarkets } from "../../src/scraper/betclicMarkets";
import { eventMarketOdds } from "../../src/scraper/marketsRun";
import { familiesOf, parseMarketKey } from "../../src/markets/catalog";
import { RawOdds } from "../../src/types";

// Every market of three football matches at both bookmakers, captured live:
// Winamax's reply to "match:<id>" (its other matches' bets left out), and
// Betclic's default page and tabs of the match.
// - Borussia Dortmund - Werder Brême (Bundesliga), 29 September 2026;
// - Danemark - Portugal and Deportivo Pereira - Independiente Santa Fe, 29
//   September 2026 too, for the markets of Betclic's "SuperSub" and "Stats
//   équipes et joueurs" tabs and Winamax's players' markets.
const FIXTURES = "tests/scraper/fixtures/markets";
const MATCHES = {
  "dortmund-werder": { winamaxId: "72513220", participants: ["Borussia Dortmund", "Werder Brême"], winamax: ["Dortmund", "Werder"] },
  "danemark-portugal": { winamaxId: "68931862", participants: ["Danemark", "Portugal"], winamax: ["Danemark", "Portugal"] },
  "pereira-santa-fe": {
    winamaxId: "74497748",
    participants: ["Deportivo Pereira", "Independiente Santa Fe"],
    winamax: ["Deportivo Pereira", "Santa Fe"],
  },
};
type Match = keyof typeof MATCHES;
const WINAMAX_ID = MATCHES["dortmund-werder"].winamaxId;

const winamaxReply = (match: Match = "dortmund-werder"): WinamaxMatchReply =>
  JSON.parse(gunzipSync(readFileSync(`${FIXTURES}/winamax-${match}.json.gz`)).toString());
const winamaxOdds = (match: Match = "dortmund-werder") => readWinamaxMarkets(winamaxReply(match), MATCHES[match].winamaxId);
// The default page first: it names the match's teams and tabs.
const betclicPages = (match: Match = "dortmund-werder"): BetclicMatchPage[] =>
  readdirSync(FIXTURES)
    .filter((f) => f.startsWith(`betclic-${match}-`))
    .sort((a, b) => Number(b.includes("-default.")) - Number(a.includes("-default.")))
    .map((f) => readBetclicMatchPage(gunzipSync(readFileSync(`${FIXTURES}/${f}`))));
const betclicOdds = (match: Match = "dortmund-werder") => readBetclicMarkets(betclicPages(match));

// market -> selection -> price
function grid(odds: RawOdds[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const o of odds) {
    if (!out.has(o.market)) out.set(o.market, new Map());
    out.get(o.market)!.set(o.selection, o.price);
  }
  return out;
}

const families = (odds: RawOdds[]) =>
  new Set(
    odds.flatMap((o) => {
      const parsed = parseMarketKey(o.market);
      return parsed.kind === "family" ? [parsed.family.key] : [];
    })
  );

describe("readWinamaxMarkets", () => {
  const odds = readWinamaxMarkets(winamaxReply(), WINAMAX_ID);
  const markets = grid(odds);

  it("reads lines, teams and outcomes from Winamax's codes", () => {
    expect(markets.get("total_goals|2.5")).toEqual(new Map([["over", 1.3], ["under", 2.7]]));
    expect(markets.get("team_goals@2|1.5")).toEqual(new Map([["over", 3], ["under", 1.25]]));
    expect(markets.get("double_chance")).toEqual(new Map([["1X", 1.07], ["12", 1.11], ["X2", 2.8]]));
    expect(markets.get("ht_ft")?.get("X/1")).toBe(4.3);
    expect(markets.get("first_goal_result")?.get("2>2")).toBe(7);
    expect(markets.get("winning_margin")?.get("1:3+")).toBe(2.85);
    expect(markets.get("multi_score")?.get("1-5,2-3,2-4,3-4")).toBeDefined();
    expect(markets.get("correct_score")?.get("2-1")).toBeDefined();
    expect(markets.get("exact_goals")?.get("9+")).toBeDefined();
  });

  it("reads players by name, and how many goals they must score", () => {
    expect(markets.get("anytime_scorer")?.get("Serhou Guirassy")).toBe(1.66);
    expect(markets.get("scorer_goals|3")?.get("Serhou Guirassy")).toBe(12.5);
    expect(markets.get("first_scorer")?.size).toBe(43);
  });

  it("leaves the match result to the listing and keeps the rest under Winamax's own names", () => {
    expect(markets.has("1X2")).toBe(false);
    expect(markets.get("wx:Quelle équipe va marquer ?")?.get("Aucune")).toBe(20);
    // A whole-goal handicap refunds a draw: no other bookmaker's is the same.
    expect(markets.get("wx:Mi-temps - Écart de buts (handicap) (-1)")?.get("Dortmund -1")).toBe(2.45);
  });

  it("reads a handicap as the first team's line, the favourite's side being yes", () => {
    // "Dortmund -1.5" yes, "Werder +1.5" no.
    expect(markets.get("handicap|-1.5")).toEqual(new Map([["1", 1.76], ["2", 1.7]]));
    expect(markets.get("ht_handicap|-0.5")).toEqual(new Map([["1", 1.62], ["2", 1.86]]));
    // "Deportivo Pereira +1.5" no, "Santa Fe -1.5" yes.
    const pereira = grid(winamaxOdds("pereira-santa-fe"));
    expect(pereira.get("handicap|1.5")).toEqual(new Map([["1", 1.27], ["2", 2.9]]));
    expect(pereira.get("ht_handicap|0.5")).toEqual(new Map([["1", 1.46], ["2", 2.15]]));
  });

  it("reads goal bands, the first goal's minute, and who scores a penalty or a header", () => {
    expect(markets.get("goal_bands")).toEqual(new Map([["0-1", 5.7], ["2-3", 2.15], ["4-6", 2.05], ["7+", 9]]));
    expect(markets.get("first_goal_minute_10")?.get("1-10")).toBe(3.2);
    expect(markets.get("first_goal_minute_10")?.get("none")).toBe(20);
    expect(markets.get("first_goal_minute_15")?.get("31-45")).toBe(4.4);
    expect(markets.get("sub_scores")).toEqual(new Map([["yes", 2.15], ["no", 1.45]]));
    const danemark = grid(winamaxOdds("danemark-portugal"));
    expect(danemark.get("penalty_goal")).toEqual(
      new Map([["1", 5.4], ["2", 4.3], ["any", 2.8], ["both", 24], ["none", 1.28]])
    );
    expect(danemark.get("header_goal")?.get("both")).toBe(15);
    expect(danemark.get("free_kick_goal")?.get("none")).toBe(1.01);
  });

  it("reads each half's scorers, and pairs of players with their short names", () => {
    const danemark = grid(winamaxOdds("danemark-portugal"));
    expect(danemark.get("ht_scorer")?.get("Cristiano Ronaldo")).toBe(3.6);
    expect(danemark.get("2h_scorer")?.get("Cristiano Ronaldo")).toBe(3);
    expect(danemark.get("scorer_both_halves")?.get("Cristiano Ronaldo")).toBe(10.5);
    expect(danemark.get("scorer_double_chance")?.get("J. Felix / G. Ramos")).toBe(1.62);
    expect(danemark.get("decisive_player_times|2")?.get("Cristiano Ronaldo")).toBe(5.1);
    // "Buteur (Serial Player)": winnings multiplied by the player's goals.
    expect(danemark.get("scorer_each_goal")?.get("Cristiano Ronaldo")).toBe(1.82);
    // "Duo Buteurs - G. Ramos + R. Hojlund": the pair is in the market's title.
    expect(danemark.get("duo_goals|1.5")?.get("G. Ramos / R. Hojlund")).toBe(4.8);
  });

  it("ignores other matches' bets and anything closed", () => {
    const reply = winamaxReply();
    const [betId, bet] = Object.entries(reply.bets!).find(([, b]) => b.marketId === 29)!;
    reply.bets![betId] = { ...bet, available: false };
    reply.bets!["999"] = { ...bet, betId: 999, matchId: 1 };
    expect(grid(readWinamaxMarkets(reply, WINAMAX_ID)).has("btts")).toBe(false);
  });
});

describe("readBetclicMarkets", () => {
  const pages = betclicPages();
  const odds = readBetclicMarkets(pages);
  const markets = grid(odds);

  it("reads a match page's teams and tabs", () => {
    expect(pages[0].contestants).toEqual([
      { name: "Borussia Dortmund", shortName: "Dortmund" },
      { name: "Werder Brême", shortName: "Werder Brême" },
    ]);
    expect(pages[0].categories.map((c) => c.id)).toEqual([
      "ca_ftb_top",
      "ca_ftb_ft",
      "ca_ftb_rslt",
      "ca_ftb_gsc",
      "ca_ftb_goa",
      "ca_ftb_cshcp",
    ]);
  });

  it("reads lines and teams from Betclic's names, full or short", () => {
    expect(markets.get("total_goals|2.5")).toEqual(new Map([["over", 1.31], ["under", 2.67]]));
    expect(markets.get("team_goals@2|0.5")).toEqual(new Map([["over", 1.38], ["under", 2.35]]));
    // "Borussia Dortmund ou Nul", "Dortmund ou Werder Brême", "Nul ou Werder Brême".
    expect(markets.get("double_chance")).toEqual(new Map([["1X", 1.08], ["12", 1.1], ["X2", 2.85]]));
    expect(markets.get("ht_ft")?.get("X/1")).toBe(4.3);
    expect(markets.get("dc_total|2.5")?.get("X2&under")).toBe(4.8);
    expect(markets.get("first_goal_result")?.get("2>2")).toBe(6.6);
    expect(markets.get("multi_score")?.get("other@1")).toBe(13.5);
  });

  it("reads sub-markets and cards by team", () => {
    // "Résultat" > "1ère MT (seule)", "Équipe qui marque (t. rég)" > "1er but".
    expect(markets.get("ht_1X2")).toEqual(new Map([["1", 1.63], ["X", 2.6], ["2", 5.4]]));
    expect(markets.get("first_team_to_score")).toEqual(new Map([["1", 1.3], ["none", 27], ["2", 2.75]]));
    expect(markets.get("clean_sheet@2")).toEqual(new Map([["yes", 9.75], ["no", 1.03]]));
    // Split in two cards, one per team.
    expect(markets.get("anytime_scorer")?.size).toBe(43);
    expect(markets.get("scorer_goals|2")?.get("Serhou Guirassy")).toBe(3.4);
    expect(markets.get("first_scorer")?.get("Serhou Guirassy")).toBe(3.6);
  });

  it("counts a market in several tabs once, even under two ids", () => {
    expect(odds.filter((o) => o.market === "double_chance")).toHaveLength(3);
    // "Écart de buts (t. rég)" on the default page and in "Résultats".
    const pereira = betclicOdds("pereira-santa-fe");
    expect(pereira.filter((o) => o.market === "handicap|-1.5")).toHaveLength(2);
    expect(pereira.some((o) => o.market === "bc:Écart de buts (t. rég) (2)")).toBe(false);
  });

  it("tells two markets of one name apart by their outcomes", () => {
    // "2ème mi-temps (seule) - Nombre total de buts": over/under lines, and bands.
    expect(markets.get("2h_total_goals|0.5")).toEqual(new Map([["over", 1.07], ["under", 5.4]]));
    expect(markets.get("2h_goal_bands")?.get("1-2")).toBe(1.55);
    // "Minute du premier but": bands of 10 minutes, and of 15.
    expect(markets.get("first_goal_minute_10")?.get("1-10")).toBe(3.1);
    expect(markets.get("first_goal_minute_10")?.get("81-90")).toBe(30);
    expect(markets.get("first_goal_minute_15")?.get("31-45")).toBe(4.3);
    expect(markets.get("first_goal_minute_15")?.get("46-60")).toBe(8.5);
  });

  it("numbers a second market of one name it doesn't know", () => {
    const page: BetclicMatchPage = {
      contestants: [],
      categories: [],
      markets: [
        { id: "1243262977343489", name: "Pari spécial", selections: [{ name: "Oui", price: 2 }] },
        { id: "1243262977343490", name: "Pari spécial", selections: [{ name: "Oui", price: 3 }] },
      ],
    };
    expect(grid(readBetclicMarkets([page]))).toEqual(
      new Map([
        ["bc:Pari spécial", new Map([["Oui", 2]])],
        ["bc:Pari spécial (2)", new Map([["Oui", 3]])],
      ])
    );
  });

  it("reads the handicaps in a goal margin, and keeps its exact margins under its own name", () => {
    // "Dortmund gagne de 2 buts ou +" and "Werder ne perd pas ou perd de 1 but
    // exactement": Dortmund -1.5.
    expect(markets.get("handicap|-1.5")).toEqual(new Map([["1", 1.81], ["2", 1.75]]));
    // "Dortmund ne perd pas": Dortmund +0.5; "Werder ne perd pas": Werder +0.5.
    expect(markets.get("handicap|0.5")?.get("1")).toBe(1.08);
    expect(markets.get("handicap|-0.5")?.get("2")).toBe(2.85);
    expect(markets.get("bc:Écart de buts (t. rég)")?.get("Borussia Dortmund gagne de 2 buts exactement")).toBe(4.1);
  });

  it("reads the second half, and who scores a penalty, a header or a free kick", () => {
    expect(markets.get("2h_1X2")).toEqual(new Map([["1", 1.56], ["X", 2.95], ["2", 5]]));
    expect(markets.get("ht_first_team_to_score")).toEqual(new Map([["1", 1.52], ["none", 4.05], ["2", 3.47]]));
    expect(markets.get("goal_bands")).toEqual(new Map([["0-1", 6.1], ["2-3", 2.2], ["4-5", 2.57], ["6+", 5.4]]));
    const danemark = grid(betclicOdds("danemark-portugal"));
    // "But marqué sur penalty" and "Les 2 équipes marquent un pénalty".
    expect(danemark.get("penalty_goal")).toEqual(new Map([["1", 6.25], ["2", 5.75], ["any", 3.3], ["both", 30]]));
    // Five markets: in the match, for each team, and for both.
    expect(danemark.get("header_goal")).toEqual(
      new Map([["any", 2.6], ["none", 1.3], ["1", 5.25], ["no@1", 1.04], ["2", 4.35], ["no@2", 1.08], ["both", 18]])
    );
    expect(danemark.get("sub_scores")).toEqual(new Map([["yes", 2.37], ["no", 1.35]]));
  });

  it("reads pairs of players, and how often a player is decisive", () => {
    const danemark = grid(betclicOdds("danemark-portugal"));
    expect(danemark.get("scorer_double_chance")?.get("G. Ramos / C. Ronaldo")).toBe(1.45);
    expect(danemark.get("decisive_player_times|3")?.get("Kasper Høgh")).toBe(40);
    // "Buteur (t. rég) - Extra gains à chaque but du joueur".
    expect(danemark.get("scorer_each_goal")?.get("Kasper Høgh")).toBe(2.82);
    expect(grid(betclicOdds("pereira-santa-fe")).get("duo_goals|1.5")?.get("H. Rodallega / N. Bustos")).toBeDefined();
  });

  it("leaves out the match result and the period slices", () => {
    expect(markets.has("1X2")).toBe(false);
    expect([...markets.keys()].some((k) => k.includes("sur la période"))).toBe(false);
  });
});

// On these three matches, one bookmaker alone offers them: Betclic the second
// half, Winamax its scorers of several goals in one half.
const BETCLIC_ONLY = new Set([
  "ht_result_btts",
  "ht_first_team_to_score",
  "ht_header_goal",
  "ht_scorers_both",
  "2h_1X2",
  "2h_double_chance",
  "2h_draw_no_bet",
  "2h_handicap",
  "2h_total_goals",
  "2h_team_goals@1",
  "2h_team_goals@2",
  "2h_btts",
  "2h_exact_goals",
  "2h_goal_bands",
  "2h_clean_sheet@1",
  "2h_clean_sheet@2",
  "2h_first_team_to_score",
  "2h_result_total",
  "2h_result_btts",
  "2h_correct_score",
  "2h_header_goal",
  "2h_scorer_double_chance",
  "2h_scorer_triple_chance",
  "2h_scorers_both",
]);
const WINAMAX_ONLY = new Set(["ht_scorer_goals", "2h_scorer_goals"]);

describe("both bookmakers on one match", () => {
  it("find every family of the catalog but the listing's own on both sides, but those one bookmaker alone offers", () => {
    const matches = Object.keys(MATCHES) as Match[];
    const winamax = families(matches.flatMap((m) => winamaxOdds(m)));
    const betclic = families(matches.flatMap((m) => betclicOdds(m)));
    const expected = familiesOf("football").map((f) => f.key).filter((k) => k !== "1X2");
    expect(expected.filter((k) => !winamax.has(k) && !BETCLIC_ONLY.has(k))).toEqual([]);
    expect(expected.filter((k) => !betclic.has(k) && !WINAMAX_ONLY.has(k))).toEqual([]);
    // And those really are one bookmaker's only.
    expect([...BETCLIC_ONLY].filter((k) => winamax.has(k))).toEqual([]);
    expect([...WINAMAX_ONLY].filter((k) => betclic.has(k))).toEqual([]);
  });

  it("line a pair of players up on one row, whatever its short names' spelling or order", () => {
    const { participants, winamax: winamaxNames } = MATCHES["danemark-portugal"];
    const byBookmaker = eventMarketOdds(
      participants,
      { winamax: { sourceId: "w", participants: winamaxNames }, betclic: { sourceId: "b", participants } },
      {
        winamax: new Map([["w", winamaxOdds("danemark-portugal")]]),
        betclic: new Map([["b", betclicOdds("danemark-portugal")]]),
      }
    );
    const price = (bookmaker: string, market: string, selection: string) =>
      byBookmaker[bookmaker].find((o) => o.market === market && o.selection === selection)?.price;
    // Winamax "J. Felix ou G. Ramos", Betclic "J. Félix / G. Ramos": both
    // named after Betclic's full names, "Goncalo Ramos" and "João Félix".
    expect(price("winamax", "scorer_double_chance", "Goncalo Ramos / João Félix")).toBe(1.62);
    expect(price("betclic", "scorer_double_chance", "Goncalo Ramos / João Félix")).toBe(1.68);
    // Winamax "R. Hojlund", Betclic "Rasmus Højlund".
    expect(price("winamax", "scorer_double_chance", "Goncalo Ramos / Rasmus Højlund")).toBe(1.64);
    const pairs = (bookmaker: string) =>
      new Set(byBookmaker[bookmaker].filter((o) => o.market === "scorer_double_chance").map((o) => o.selection));
    const common = [...pairs("winamax")].filter((p) => pairs("betclic").has(p));
    expect(common.length).toBeGreaterThanOrEqual(pairs("winamax").size * 0.8);
  });

  it("price the same outcomes under the same keys", () => {
    const winamax = grid(readWinamaxMarkets(winamaxReply(), WINAMAX_ID));
    const betclic = grid(readBetclicMarkets(betclicPages()));
    for (const market of ["btts", "result_btts", "ht_ft", "winning_margin", "team_exact_goals@1", "highest_scoring_half"]) {
      expect([...winamax.get(market)!.keys()].sort()).toEqual([...betclic.get(market)!.keys()].sort());
    }
  });
});
