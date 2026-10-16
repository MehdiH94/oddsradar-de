import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { parseSearch } from "../../src/reference/exchange";
import { findOnExchange, listedTheOtherWay, referenceName, searchTerm } from "../../src/reference/match";

const searches = JSON.parse(gunzipSync(readFileSync(`${__dirname}/fixtures/exchange-search.json.gz`)).toString());
const candidates = [...parseSearch(searches.arsenal), ...parseSearch(searches.poland), ...parseSearch(searches.barcelona)];
const at = (ms: number, minutes = 0) => new Date(ms + minutes * 60_000).toISOString();

describe("referenceName", () => {
  it("names countries in English", () => {
    expect(referenceName("Pologne (U21)")).toBe("poland u21");
    expect(referenceName("Îles Féroé (U21)")).toBe("faroe islands u21");
    expect(referenceName("Rép. Tchèque (U21)")).toBe("czechia u21");
    expect(referenceName("Trinité-et-Tobago")).toBe("trinidad and tobago");
  });

  it("reads a longer country name before the shorter one it contains", () => {
    expect(referenceName("Irlande du Nord (U21)")).toBe("northern ireland u21");
    expect(referenceName("Irlande")).toBe("ireland");
  });

  it("marks both sides' women's teams the same way", () => {
    expect(referenceName("Paris FC F.")).toBe("paris fc women");
    expect(referenceName("Paris FC (W)")).toBe("paris fc women");
  });

  it("leaves club names alone", () => {
    expect(referenceName("Arsenal")).toBe("arsenal");
    expect(referenceName("Chelsea")).toBe("chelsea");
  });
});

describe("findOnExchange", () => {
  it("finds a match named in French among the exchange's English names", () => {
    const found = findOnExchange(
      { eventId: "e1", participants: ["Pologne (U21)", "Suède (U21)"], startTime: at(1790784000000) },
      candidates
    );
    expect(found?.match.eventId).toBe("36131057");
    expect(found?.selections).toEqual({ "1": 210090, X: 58805, "2": 210088 });
  });

  it("gives our outcomes the right runners when the exchange lists the teams the other way", () => {
    const found = findOnExchange(
      { eventId: "e1", participants: ["Suède (U21)", "Pologne (U21)"], startTime: at(1790784000000) },
      candidates
    );
    expect(found?.selections).toEqual({ "1": 210088, X: 58805, "2": 210090 });
  });

  it("finds a women's match", () => {
    const found = findOnExchange(
      { eventId: "e1", participants: ["Paris FC F.", "Arsenal F."], startTime: at(1790786700000) },
      candidates
    );
    expect(found?.match.eventId).toBe("36124426");
  });

  it("tolerates a few minutes between the two kick-offs, not hours", () => {
    const match = (minutes: number) =>
      findOnExchange({ eventId: "e1", participants: ["Arsenal", "Leeds"], startTime: at(1791631800000, minutes) }, candidates);
    expect(match(5)?.match.eventId).toBe("36065339");
    expect(match(180)).toBeNull();
  });

  it("doesn't take a club's other side for the club", () => {
    // Arsenal's women play Paris FC's at that time, not the men's teams.
    expect(
      findOnExchange({ eventId: "e1", participants: ["Paris FC", "Arsenal"], startTime: at(1790786700000) }, candidates)
    ).toBeNull();
    // The seniors don't play when the U21 teams do.
    expect(
      findOnExchange({ eventId: "e1", participants: ["Pologne", "Suède"], startTime: at(1790784000000) }, candidates)
    ).toBeNull();
  });

  it("tells apart two clubs of one city by the exchange's initial: Tokyo V, the Verdy, and FC Tokyo", () => {
    // The exchange's derby of 17/10/2026, its runners as it listed them.
    const derby = {
      eventId: "36179287",
      participants: ["Tokyo V", "FC Tokyo"] as [string, string],
      startTime: "2026-10-17T05:00:00.000Z",
      marketId: "1.263678294",
      runners: { home: 350849, away: 263080, draw: 58805 },
    };
    const found = findOnExchange({ eventId: "e1", participants: ["Tokyo Verdy", "FC Tokyo"], startTime: derby.startTime }, [derby]);
    expect(found?.selections).toEqual({ "1": 350849, X: 58805, "2": 263080 });
    const reversed = findOnExchange({ eventId: "e1", participants: ["FC Tokyo", "Tokyo Verdy"], startTime: derby.startTime }, [derby]);
    expect(reversed?.selections).toEqual({ "1": 263080, X: 58805, "2": 350849 });
  });

  it("finds nothing among no candidates", () => {
    expect(findOnExchange({ eventId: "e1", participants: ["Arsenal", "Leeds"], startTime: at(1791631800000) }, [])).toBeNull();
  });
});

describe("searchTerm", () => {
  it("searches a team by its longest telling word, in English", () => {
    expect(searchTerm("Pologne (U21)")).toBe("poland");
    expect(searchTerm("Paris FC F.")).toBe("paris");
    expect(searchTerm("Îles Féroé (U21)")).toBe("faroe");
    expect(searchTerm("Irlande du Nord")).toBe("ireland");
  });

  it("has nothing to search for a name without a telling word", () => {
    expect(searchTerm("FC")).toBeUndefined();
  });
});

describe("listedTheOtherWay", () => {
  it("tells a match now listed the other way round, whichever bookmaker spells its teams", () => {
    const found = ["Norvège (U21)", "Israël (U21)"];
    expect(listedTheOtherWay(found, ["Israël (U21)", "Norvège (U21)"])).toBe(true);
    // Vbet's and NetBet's spelling, the same way round.
    expect(listedTheOtherWay(found, ["Norvège U21", "Israël U21"])).toBe(false);
    expect(listedTheOtherWay(found, ["Israël U21", "Norvège U21"])).toBe(true);
    expect(listedTheOtherWay(found, found)).toBe(false);
    expect(listedTheOtherWay(["Iga Swiatek", "Donna Vekic"], ["D. Vekic", "I. Swiatek"])).toBe(true);
  });
});
