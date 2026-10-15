import { describe, it, expect } from "vitest";
import { favoriteRank, normalizeCompetition } from "./favoriteCompetitions";

describe("favoriteRank", () => {
  it("puts the big leagues and the Champions League in the order asked for", () => {
    const names = ["Ligue 1", "Serie A", "LaLiga", "Bundesliga", "Premier League", "Ligue des Champions"];
    expect(names.map((name) => favoriteRank("football", name))).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("knows them under the names bookmakers give them", () => {
    expect(favoriteRank("football", "Ligue 1 McDonald's®")).toBe(0);
    expect(favoriteRank("football", "Ligue 1 Uber Eats")).toBe(0);
    expect(favoriteRank("football", "Serie A TIM")).toBe(1);
    expect(favoriteRank("football", "La Liga")).toBe(2);
    expect(favoriteRank("football", "LaLiga EA Sports")).toBe(2);
    expect(favoriteRank("football", "Bundesliga")).toBe(3);
    expect(favoriteRank("football", "Premier League")).toBe(4);
    expect(favoriteRank("football", "Ligue des Champions UEFA")).toBe(5);
    expect(favoriteRank("football", "Ligue des Champions de l'UEFA - Phase de ligue")).toBe(5);
    expect(favoriteRank("football", "UEFA Champions League")).toBe(5);
    expect(favoriteRank("football", "ligue 1")).toBe(0);
  });

  it("does not take their lookalikes for them", () => {
    for (const name of [
      "Ligue 2",
      "Ligue 1 Féminine",
      "Ligue des Champions F.",
      "Ligue des Champions UEFA Féminine",
      "UEFA Champions League Women",
      "Ligue des Champions - Qualifications",
      "Bundesliga 2",
      "2. Bundesliga",
      "Premier League 2",
      "LaLiga 2",
      "LaLiga Hypermotion",
      "Brasileiro Serie A - Brésil",
      "Serie B",
      "Liga Portugal",
      "Ligue Europa",
    ]) {
      expect(favoriteRank("football", name), name).toBeNull();
    }
  });

  it("has favorites for football only", () => {
    expect(favoriteRank("tennis", "Ligue 1")).toBeNull();
    expect(favoriteRank("fléchettes", "PDC Premier League")).toBeNull();
  });
});

describe("normalizeCompetition", () => {
  it("leaves out the case, the accents and the punctuation", () => {
    expect(normalizeCompetition("Ligue 1 McDonald's®")).toBe("ligue 1 mcdonald s");
    expect(normalizeCompetition("Coupe de l'Épée")).toBe("coupe de l epee");
  });
});
