import { describe, it, expect } from "vitest";
import { readUrlFilters, urlFiltersQuery } from "./urlFilters";
import { ALL_BOOKMAKERS } from "./bookmakers";

describe("readUrlFilters", () => {
  it("falls back to the page's defaults on an empty URL", () => {
    expect(readUrlFilters("")).toEqual({
      sport: "football",
      sort: "trj",
      q: "",
      bookmakers: ["leovegas", "merkurbets", "twentybet", "admiralbet", "betathome", "tipico", "winamaxde"],
      page: 1,
    });
  });

  it("reads all the bookmakers only when they are all named", () => {
    expect(readUrlFilters("?bookmakers=winamaxde,tipico,betathome,admiralbet,twentybet,merkurbets,leovegas").bookmakers).toEqual([...ALL_BOOKMAKERS]);
  });

  it("reads every filter", () => {
    expect(readUrlFilters("?sport=tennis&sort=start&q=nadal&bookmakers=merkurbets&page=3")).toEqual({
      sport: "tennis",
      sort: "start",
      q: "nadal",
      bookmakers: ["merkurbets"],
      page: 3,
    });
  });

  it("reads a sport and a search with spaces and accents", () => {
    const filters = readUrlFilters("?sport=hockey+sur+glace&q=Saint-%C3%89tienne");
    expect(filters.sport).toBe("hockey sur glace");
    expect(filters.q).toBe("Saint-Étienne");
  });

  it("corrects invalid values", () => {
    expect(readUrlFilters("?sort=price").sort).toBe("trj");
    for (const page of ["0", "-3", "abc", "1.5"]) expect(readUrlFilters(`?page=${page}`).page).toBe(1);
    expect(readUrlFilters("?bookmakers=bwin,merkurbets").bookmakers).toEqual(["merkurbets"]);
  });

  it("keeps the bookmakers in their usual order", () => {
    expect(readUrlFilters("?bookmakers=merkurbets,leovegas").bookmakers).toEqual(["leovegas", "merkurbets"]);
  });

  it("reads an empty bookmakers list as none ticked", () => {
    expect(readUrlFilters("?bookmakers=").bookmakers).toEqual([]);
  });

  it("reads the value order and the value bets' category", () => {
    expect(readUrlFilters("?sort=value").sort).toBe("value");
    expect(readUrlFilters("?sport=value-bets").sport).toBe("value-bets");
  });

  it("reads the players' markets filter, on only when \"1\"", () => {
    expect(readUrlFilters("?players=1").players).toBe(true);
    expect(readUrlFilters("?players=0").players).toBeUndefined();
    expect(readUrlFilters("").players).toBeUndefined();
  });

  it("reads the competition, with its spaces and accents, left out when empty", () => {
    expect(readUrlFilters("?competition=Ligue+1").competition).toBe("Ligue 1");
    expect(readUrlFilters("?competition=Ligue%20des%20champions%20UEFA%20F%C3%A9minine").competition).toBe("Ligue des champions UEFA Féminine");
    expect(readUrlFilters("?competition=%20").competition).toBeUndefined();
    expect(readUrlFilters("").competition).toBeUndefined();
  });
});

describe("urlFiltersQuery", () => {
  it("writes the competition only when there is one", () => {
    const base = { sport: "football", sort: "trj" as const, q: "", bookmakers: ["leovegas", "merkurbets", "twentybet", "admiralbet", "betathome", "tipico", "winamaxde"], page: 1 };
    expect(urlFiltersQuery({ ...base, competition: "Ligue 1" })).toBe("sport=football&sort=trj&competition=Ligue+1");
    expect(urlFiltersQuery({ ...base, competition: "" })).toBe("sport=football&sort=trj");
  });

  it("writes the sport and the sort, and leaves out the other defaults", () => {
    expect(
      urlFiltersQuery({ sport: "football", sort: "trj", q: "", bookmakers: ["leovegas", "merkurbets", "twentybet", "admiralbet", "betathome", "tipico", "winamaxde"], page: 1 })
    ).toBe("sport=football&sort=trj");
  });

  it("leaves out the bookmakers when all are ticked: they are the default", () => {
    expect(urlFiltersQuery({ sport: "football", sort: "trj", q: "", bookmakers: [...ALL_BOOKMAKERS], page: 1 })).toBe("sport=football&sort=trj");
  });

  it("writes what differs from the defaults", () => {
    expect(urlFiltersQuery({ sport: "tennis", sort: "start", q: "nadal", bookmakers: ["merkurbets"], page: 2 })).toBe(
      "sport=tennis&sort=start&q=nadal&bookmakers=merkurbets&page=2"
    );
    expect(urlFiltersQuery({ sport: "football", sort: "trj", q: "", bookmakers: [], page: 1 })).toBe(
      "sport=football&sort=trj&bookmakers="
    );
    expect(urlFiltersQuery({ sport: "football", sort: "trj", q: "", bookmakers: ["leovegas"], page: 1 })).toBe(
      "sport=football&sort=trj&bookmakers=leovegas"
    );
    expect(
      urlFiltersQuery({
        sport: "football",
        sort: "trj",
        q: "",
        bookmakers: ["leovegas", "merkurbets", "twentybet", "admiralbet", "betathome", "tipico", "winamaxde"],
        players: true,
        page: 2,
      })
    ).toBe("sport=football&sort=trj&players=1&page=2");
    expect(
      urlFiltersQuery({ sport: "value-bets", sort: "value", q: "", bookmakers: ["leovegas", "merkurbets", "twentybet", "admiralbet", "betathome", "tipico", "winamaxde"], page: 1 })
    ).toBe("sport=value-bets&sort=value");
  });

  it("reads back what it writes", () => {
    const filters = { sport: "hockey sur glace", sort: "start" as const, q: "Saint-Étienne", bookmakers: [], page: 4 };
    expect(readUrlFilters(`?${urlFiltersQuery(filters)}`)).toEqual(filters);
    const all = { sport: "football", sort: "trj" as const, q: "", bookmakers: [...ALL_BOOKMAKERS], page: 1 };
    expect(readUrlFilters(`?${urlFiltersQuery(all)}`)).toEqual(all);
  });
});
