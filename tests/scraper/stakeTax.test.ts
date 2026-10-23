import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { netOfStakeTax } from "../../src/scraper/stakeTax";
import { LEOVEGAS } from "../../src/scraper/kambi";
import { MERKURBETS_TAX_ON_STAKE } from "../../src/scraper/merkurbets";
import { ADMIRALBET_TAX_ON_STAKE } from "../../src/scraper/admiralbet";
import { BETATHOME_TAX } from "../../src/scraper/betathome";
import { BETWAY_TAX } from "../../src/scraper/betway";
import { ODDSET_TAX } from "../../src/scraper/oddset";
import { SPORTINGBET_TAX } from "../../src/scraper/sportingbet";
import { VBET_TAX } from "../../src/scraper/vbet";
import { SPORT888_TAX } from "../../src/scraper/888sport";

describe("netOfStakeTax", () => {
  it("takes the tax off the price, to the thousandth", () => {
    expect(netOfStakeTax(2, 0.05)).toBe(1.9);
    expect(netOfStakeTax(2, 0.053)).toBe(1.894);
    expect(netOfStakeTax(1.57, 0.05)).toBe(1.492);
    expect(netOfStakeTax(3.45, 0)).toBe(3.45);
  });

  it("leaves a missing price missing", () => {
    expect(netOfStakeTax(NaN, 0.05)).toBeNaN();
    expect(netOfStakeTax(Infinity, 0.05)).toBe(Infinity);
  });
});

// Each bookmaker's rate, as its terms give it (each scraper's comment): a
// wrong edit would move every one of its value bets and surebets silently.
const RATES: Record<string, number> = {
  leovegas: 0.05,
  merkurbets: 0.05,
  sportingbet: 0.05,
  "888sport": 0.05,
  vbet: 0.05033238,
  admiralbet: 0.053,
  betathome: 0.053,
  betway: 0.053,
  oddset: 0.053,
};

describe("the bookmakers' betting tax", () => {
  it("is each one's own rate", () => {
    expect({
      leovegas: LEOVEGAS.taxOnStake,
      merkurbets: MERKURBETS_TAX_ON_STAKE,
      sportingbet: SPORTINGBET_TAX,
      "888sport": SPORT888_TAX,
      vbet: VBET_TAX,
      admiralbet: ADMIRALBET_TAX_ON_STAKE,
      betathome: BETATHOME_TAX,
      betway: BETWAY_TAX,
      oddset: ODDSET_TAX,
    }).toEqual(RATES);
  });

  // The dashboard says the rate in each price's tooltip (web/src/bookmakers.ts,
  // stakeTax): the same as the scrapers', rounded to a tenth of a percent; 0 at
  // 20bet, Tipico and Winamax, which take none off.
  it("is the one the dashboard shows", () => {
    const branding = readFileSync(resolve(__dirname, "../../web/src/bookmakers.ts"), "utf8");
    const shown = Object.fromEntries(
      [...branding.matchAll(/^\s*"?([\w]+)"?: \{ name: "[^"]+".*stakeTax: ([\d.]+)/gm)].map(([, id, rate]) => [id, Number(rate)])
    );
    const rounded = Object.fromEntries(Object.entries(RATES).map(([id, rate]) => [id, Math.round(rate * 1000) / 1000]));
    expect(shown).toEqual({ ...rounded, twentybet: 0, tipico: 0, winamaxde: 0 });
  });
});
