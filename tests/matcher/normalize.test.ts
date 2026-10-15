import { describe, it, expect } from "vitest";
import { foldGermanDigraphs, normalizeName } from "../../src/matcher/normalize";

describe("normalizeName", () => {
  it("lowercases, strips accents, and collapses punctuation/whitespace", () => {
    expect(normalizeName("Étoile Rouge  de  Belgrade!")).toBe("etoile rouge de belgrade");
  });

  it("spells out the letters that carry no separate accent", () => {
    expect(normalizeName("Rasmus Højlund")).toBe("rasmus hojlund");
    expect(normalizeName("Bodø/Glimt")).toBe("bodoglimt");
    expect(normalizeName("Łukasz Fabiański")).toBe("lukasz fabianski");
  });

  it("trims leading/trailing whitespace", () => {
    expect(normalizeName("  Real Madrid  ")).toBe("real madrid");
  });

  // The matcher asks for the same names again and again, so they are remembered
  // (up to a limit): the answer is the same the second time, and after the limit.
  it("gives the same answer when asked again, and once the names it remembers are past its limit", () => {
    expect(normalizeName("Étoile Rouge")).toBe("etoile rouge");
    expect(normalizeName("Étoile Rouge")).toBe("etoile rouge");
    for (let i = 0; i < 60_000; i++) normalizeName(`Équipe ${i}`);
    expect(normalizeName("Étoile Rouge")).toBe("etoile rouge");
    expect(normalizeName("Équipe 59999")).toBe("equipe 59999");
  });
});

describe("foldGermanDigraphs", () => {
  it("gives a name written with umlauts and one written with their digraphs the same form", () => {
    for (const [umlauts, digraphs] of [
      ["Borussia Mönchengladbach", "Borussia Moenchengladbach"],
      ["Fortuna Düsseldorf", "Fortuna Duesseldorf"],
      ["1. FC Köln", "1. FC Koeln"],
      ["Jahn Regensburg Ändern", "Jahn Regensburg Aendern"],
    ]) {
      expect(foldGermanDigraphs(normalizeName(digraphs)), digraphs).toBe(foldGermanDigraphs(normalizeName(umlauts)));
    }
    // The English sites drop the umlaut altogether.
    expect(foldGermanDigraphs(normalizeName("Monchengladbach"))).toBe(foldGermanDigraphs(normalizeName("Mönchengladbach")));
  });
});
