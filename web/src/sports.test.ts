import { describe, it, expect } from "vitest";
import { hasMarkets, sportEmoji, sportLabel } from "./sports";

describe("sportLabel", () => {
  it("capitalizes the API's lowercased sport keys", () => {
    expect(sportLabel("hockey sur glace")).toBe("Ice hockey");
    expect(sportLabel("formule 1")).toBe("Formula 1");
  });

  it("writes acronyms and roman numerals in capitals", () => {
    expect(sportLabel("rugby à xv")).toBe("Rugby union");
    expect(sportLabel("rugby à xiii")).toBe("Rugby league");
    expect(sportLabel("mma")).toBe("MMA");
  });
});

describe("sportEmoji", () => {
  it("pictures each sport, and one it doesn't know yet with a medal", () => {
    expect(sportEmoji("football")).toBe("⚽");
    expect(sportEmoji("curling")).toBe("🏅");
  });

  it("pictures badminton, table tennis and judo, and names them in full", () => {
    expect(sportEmoji("badminton")).toBe("🏸");
    expect(sportEmoji("tennis de table")).toBe("🏓");
    expect(sportEmoji("judo")).toBe("🥋");
    expect(sportLabel("tennis de table")).toBe("Table tennis");
  });
});

describe("hasMarkets", () => {
  it("keeps the players' list to the sports whose matches have players' markets", () => {
    expect(hasMarkets("football")).toBe(true);
    expect(hasMarkets("basketball")).toBe(true);
    // A tennis match's players are its two.
    expect(hasMarkets("tennis")).toBe(false);
    expect(hasMarkets("golf")).toBe(false);
  });
});
