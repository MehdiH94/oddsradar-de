import { describe, it, expect } from "vitest";
import { competitionList } from "./competitionList";

const base = { sport: "football", current: "", query: "", expanded: false };
const FOOTBALL = [
  "Bundesliga 2",
  "Ligue 1",
  "Coupe de France",
  "Serie A",
  "Eredivisie",
  "Bundesliga",
  "Championship",
  "Premier League",
  "LaLiga",
  "Ligue des Champions",
  "Ligue 2",
  "Super Lig",
];

describe("competitionList", () => {
  it("puts the favorites first, in order, then the others alphabetically", () => {
    const list = competitionList({ ...base, competitions: FOOTBALL, expanded: true });
    expect(list.favorites).toEqual(["Bundesliga", "Ligue des Champions", "Premier League", "LaLiga", "Serie A", "Ligue 1"]);
    expect(list.others).toEqual(["Bundesliga 2", "Championship", "Coupe de France", "Eredivisie", "Ligue 2", "Super Lig"]);
    expect(list.total).toBe(12);
  });

  it("folds to the favorites and three others, and says it can unfold", () => {
    const list = competitionList({ ...base, competitions: FOOTBALL });
    expect(list.favorites).toHaveLength(6);
    expect(list.others).toEqual(["Bundesliga 2", "Championship", "Coupe de France"]);
    expect(list.foldable).toBe(true);
  });

  it("keeps the chosen competition in sight when folded, even one the sport no longer has", () => {
    expect(competitionList({ ...base, competitions: FOOTBALL, current: "Super Lig" }).others).toEqual([
      "Bundesliga 2",
      "Championship",
      "Coupe de France",
      "Super Lig",
    ]);
    const missing = competitionList({ ...base, competitions: FOOTBALL, current: "Ligue 3" });
    expect(missing.others).toContain("Ligue 3");
    expect(missing.total).toBe(13);
  });

  it("does not fold a short list, nor a list with no favorites to put first when little is hidden", () => {
    expect(competitionList({ ...base, competitions: ["Coupe de France", "Ligue 1"] }).foldable).toBe(false);
    const five = ["A", "B", "C", "D", "E"];
    const list = competitionList({ ...base, sport: "tennis", competitions: five });
    expect(list.foldable).toBe(true);
    expect(competitionList({ ...base, sport: "tennis", competitions: ["A", "B", "C", "D"] })).toMatchObject({
      foldable: false,
      others: ["A", "B", "C", "D"],
    });
  });

  it("has no favorites outside football", () => {
    const list = competitionList({ ...base, sport: "tennis", competitions: ["Ligue 1", "ATP Paris"], expanded: true });
    expect(list.favorites).toEqual([]);
    expect(list.others).toEqual(["ATP Paris", "Ligue 1"]);
  });

  it("searches all of them, without case or accents, unfolded, favorites still first", () => {
    const list = competitionList({ ...base, competitions: FOOTBALL, query: "LIGUE" });
    expect(list.searching).toBe(true);
    expect(list.foldable).toBe(false);
    expect(list.favorites).toEqual(["Ligue des Champions", "Ligue 1"]);
    expect(list.others).toEqual(["Ligue 2"]);
    expect(competitionList({ ...base, competitions: ["Coupe de l'Épée"], query: "epee" }).others).toEqual(["Coupe de l'Épée"]);
    expect(competitionList({ ...base, competitions: FOOTBALL, query: "zzz" })).toMatchObject({ favorites: [], others: [] });
  });
});
