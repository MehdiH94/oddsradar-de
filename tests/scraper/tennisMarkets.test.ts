import { describe, it, expect } from "vitest";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readWinamaxMarkets, WinamaxMatchReply } from "../../src/scraper/winamaxMarkets";
import { readBetclicMatchPage, readBetclicMarkets } from "../../src/scraper/betclicMarkets";
import { familiesOf, parseMarketKey } from "../../src/markets/catalog";
import { RawOdds } from "../../src/types";

// Three real ATP matches of 4/10/2026, every market at each bookmaker.
const FIXTURES = join(__dirname, "fixtures/markets");
const MATCHES = ["alex-de-minaur-hubert-hurkacz", "carlos-alcaraz-jaume-munar", "jiri-lehecka-valentin-vacherot"] as const;
type Match = (typeof MATCHES)[number];
const TABS = ["default", "ca_ten_rslt", "ca_ten_sts", "ca_ten_gms", "ca_ten_ptss"];

function winamaxReply(match: Match): WinamaxMatchReply {
  return JSON.parse(gunzipSync(readFileSync(join(FIXTURES, `winamax-tennis-${match}.json.gz`))).toString());
}
function winamaxOdds(match: Match): RawOdds[] {
  const reply = winamaxReply(match);
  return readWinamaxMarkets(reply, Object.keys(reply.matches ?? {})[0]);
}
function betclicOdds(match: Match): RawOdds[] {
  return readBetclicMarkets(TABS.map((tab) => readBetclicMatchPage(gunzipSync(readFileSync(join(FIXTURES, `betclic-tennis-${match}-${tab}.bin.gz`))))));
}
const grid = (odds: RawOdds[]) => {
  const markets = new Map<string, Map<string, number>>();
  for (const o of odds) markets.set(o.market, (markets.get(o.market) ?? new Map()).set(o.selection, o.price));
  return markets;
};
const families = (odds: RawOdds[]) =>
  new Set(odds.map((o) => parseMarketKey(o.market)).flatMap((p) => (p.kind === "family" ? [p.family.key] : [])));

describe("a tennis match's markets", () => {
  const winamax = grid(winamaxOdds("alex-de-minaur-hubert-hurkacz"));
  const betclic = grid(betclicOdds("alex-de-minaur-hubert-hurkacz"));

  it("read the same bets the same way at both bookmakers, line by line", () => {
    // De Minaur -1.5 games: Winamax's "Écart de jeux" hcp=-1.5, Betclic's "De
    // Minaur gagne de 2 ou +" and "Hurkacz ne perd pas ou perd de 1 exactement".
    expect(winamax.get("games_handicap|-1.5")).toEqual(new Map([["1", 1.76], ["2", 1.7]]));
    expect(betclic.get("games_handicap|-1.5")).toEqual(new Map([["1", 1.75], ["2", 1.7]]));
    // "Hurkacz ne perd pas": Hurkacz +0.5, so De Minaur -0.5.
    expect(betclic.get("games_handicap|-0.5")).toEqual(new Map([["1", 1.64], ["2", 1.82]]));
    expect(winamax.get("total_games|22.5")).toEqual(new Map([["over", 1.7], ["under", 1.86]]));
    expect(betclic.get("total_games|22.5")).toEqual(new Map([["over", 1.65], ["under", 1.8]]));
    expect(winamax.get("player_games@2|12.5")).toEqual(new Map([["over", 1.72], ["under", 1.74]]));
    expect(betclic.get("player_games@2|12.5")).toEqual(new Map([["over", 1.72], ["under", 1.73]]));
    // Winamax's 199 is a score in sets here, not a football score.
    expect(winamax.get("set_betting")).toEqual(new Map([["2-0", 2.5], ["2-1", 3.6], ["1-2", 4], ["0-2", 3.2]]));
    expect(betclic.get("set_betting")).toEqual(new Map([["2-0", 2.55], ["0-2", 3.2], ["2-1", 3.65], ["1-2", 4.2]]));
    expect(winamax.has("correct_score")).toBe(false);
    expect(winamax.get("set_handicap|-1.5")).toEqual(new Map([["1", 2.35], ["2", 1.34]]));
    expect(betclic.get("set_handicap|-1.5")).toEqual(new Map([["1", 2.55], ["2", 1.39]]));
    expect(winamax.get("set1_match")).toEqual(new Map([["1/1", 1.92], ["2/2", 2.25], ["2/1", 6.25], ["1/2", 7]]));
    expect(betclic.get("set1_match")).toEqual(new Map([["1/1", 1.98], ["1/2", 8], ["2/1", 7], ["2/2", 2.45]]));
    expect(winamax.get("winner_total_games|22.5")).toEqual(
      new Map([["1&over", 2.75], ["1&under", 2.85], ["2&over", 3.1], ["2&under", 3.75]])
    );
    expect(winamax.get("exact_sets")).toEqual(new Map([["2", 1.5], ["3", 2]]));
    expect(betclic.get("exact_sets")).toEqual(new Map([["2", 1.53], ["3", 2.06]]));
    expect([winamax.get("set2_winner"), betclic.get("set2_winner")]).toEqual([
      new Map([["1", 1.66], ["2", 1.9]]),
      new Map([["1", 1.62], ["2", 1.84]]),
    ]);
    expect(winamax.get("set1_correct_score")?.get("7-6")).toBe(5.7);
    expect(betclic.get("set1_correct_score")?.get("6-7")).toBe(5.4);
  });

  it("reads the aces and breaks, Betclic's aces over a line only", () => {
    expect(winamax.get("player_aces@2|9.5")).toEqual(new Map([["over", 1.8], ["under", 1.66]]));
    expect(betclic.get("player_aces@2|9.5")).toEqual(new Map([["over", 1.8]]));
    expect(winamax.get("most_aces")).toEqual(new Map([["1", 15], ["X", 15], ["2", 1.01]]));
    expect(betclic.get("most_aces")).toEqual(new Map([["1", 3.5], ["X", 10], ["2", 1.15]]));
    expect(winamax.get("player_breaks@1|2.5")).toEqual(new Map([["over", 1.65], ["under", 1.9]]));
    expect(betclic.get("first_break")).toEqual(new Map([["1", 1.45], ["2", 2.1]]));
  });

  it("leaves the winner to the listing, and Betclic's boosted combination out", () => {
    expect([...winamax.keys(), ...betclic.keys()].filter((k) => /^(wx:|bc:)?vainqueur( du match)?$/i.test(k))).toEqual([]);
    // Lehecka - Vacherot's combination comes as "Tie-break dans le match".
    const lehecka = grid(betclicOdds("jiri-lehecka-valentin-vacherot"));
    expect(lehecka.get("tiebreak")).toEqual(new Map([["yes", 1.72], ["no", 1.72]]));
    expect(lehecka.has("bc:Tie-break dans le match")).toBe(false);
  });

  it("keeps each bookmaker's own markets under their names", () => {
    expect(winamax.get("wx:Résultat après 4 jeux")?.get("Match nul")).toBe(1.52);
    expect(betclic.get("bc:Perd le 1er set et gagne le match")?.get("Alex De Minaur")).toBe(6);
  });

  it("find every tennis family at both bookmakers, but Winamax's tie-break, offered on few matches", () => {
    const all = familiesOf("tennis").map((f) => f.key);
    const atWinamax = new Set(MATCHES.flatMap((m) => [...families(winamaxOdds(m))]));
    const atBetclic = new Set(MATCHES.flatMap((m) => [...families(betclicOdds(m))]));
    expect(all.filter((k) => !atWinamax.has(k))).toEqual(["tiebreak"]);
    expect(all.filter((k) => !atBetclic.has(k))).toEqual([]);
  });
});
