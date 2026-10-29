import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { landingUrl, parseTwentybetPromos } from "../../src/promos/twentybet";

// 12 of the 24 promotions of 20bet's list as read from the VPS on 28/10/2026
// (`vps-report promo-samples`, the mirror 20betz0ne1.com): its 8 sports ones,
// both VIP programmes and two casino ones; their terms cut at 1 500
// characters, their images left out.
const LIST = JSON.parse(readFileSync(join(__dirname, "fixtures/twentybet-promotions.json"), "utf8"));

describe("20bet's promotions", () => {
  it("keeps the sports promotions and the sports VIP programme, not the casino's", () => {
    const promos = parseTwentybetPromos(LIST);
    expect(promos.map((p) => [p.sourceKey, p.title])).toEqual([
      ["twentybet:2", "Ersteinzahlung"],
      ["twentybet:5", "Prognosen"],
      ["twentybet:10", "Samstags-Reload-Bonus"],
      ["twentybet:44", "Wöchentliche Prognose"],
      ["twentybet:15", "Cashout"],
      ["twentybet:11", "Wett-Turnier"],
      ["twentybet:8", "Sport-VIP-Programm"],
      ["twentybet:16", "Steigern Sie Ihre Gewinnquoten!"],
      ["twentybet:40", "Bet Builder"],
    ]);
  });

  it("gives each its bonus code and text, and its page on 20bet.com rather than the mirror", () => {
    const saturday = parseTwentybetPromos(LIST).find((p) => p.sourceKey === "twentybet:10")!;
    expect(saturday).toEqual({
      sourceKey: "twentybet:10",
      bookmaker: "twentybet",
      title: "Samstags-Reload-Bonus",
      details: "Bonuscode: SRB\nJede Woche Freiwetten im Wert von bis zu 100 € für aktive 20BET-Spieler",
      url: "https://20bet.com/de/promotions/saturday-reload",
      endsAt: null,
    });
    for (const promo of parseTwentybetPromos(LIST)) {
      expect(promo.url).toMatch(/^https:\/\/20bet\.com\//);
      expect(promo.details).not.toMatch(/<[a-z/]|&[a-z#0-9]+;/i);
    }
  });

  it("reads an end when the list gives one", () => {
    const [promo] = parseTwentybetPromos({
      data: [{ id: 99, type: 1, title: "Quotenboost", mobileDescription: "Bis Sonntag", endsAt: "2026-11-02T22:59:00Z" }],
    });
    expect(promo).toMatchObject({ details: "Bis Sonntag", endsAt: "2026-11-02T22:59:00.000Z", url: "https://20bet.com/de/promotions" });
  });

  it("leads to the promotions page without a landing, and fails on an answer without its list", () => {
    expect(landingUrl(null)).toBe("https://20bet.com/de/promotions");
    expect(landingUrl("not a url")).toBe("https://20bet.com/de/promotions");
    expect(() => parseTwentybetPromos({ status: "error" })).toThrow("no list");
  });
});
