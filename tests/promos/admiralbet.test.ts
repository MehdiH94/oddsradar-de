import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ADMIRALBET_PROMOS_URL, bannerUrl, parseAdmiralbetBanners } from "../../src/promos/admiralbet";

// Eight of the 146 campaigns of Admiralbet's banners list as read on
// 28/10/2026: the three the promotions page shows under its sports filter,
// the responsible-gaming page (under both filters), a home-page teaser, a
// slots promotion and two of a seasonal calendar.
const BANNERS = JSON.parse(readFileSync(join(__dirname, "fixtures/admiralbet-banners.json"), "utf8"));
const NOW = new Date("2026-10-28T07:00:00Z");

describe("Admiralbet's promotions", () => {
  it("keeps the banners of the promotions page's sports filter, each with its text and link", () => {
    const promos = parseAdmiralbetBanners(BANNERS, NOW);
    expect(promos.map((p) => [p.sourceKey, p.title, p.url, p.endsAt])).toEqual([
      ["admiralbet:6061920", "100% WildcardBet + 10€ FreeBet", "https://www.admiralbet.de/de/registrieren", null],
      ["admiralbet:4433622", "Jetzt schnell und bequem am Handy wetten", ADMIRALBET_PROMOS_URL, null],
      ["admiralbet:7628150", "Deine persönliche Wildcard für Wetten auf alle Sportarten", "https://www.admiralbet.de/de/sports/", null],
    ]);
    for (const promo of promos) {
      expect(promo.bookmaker).toBe("admiralbet");
      expect(promo.details).not.toMatch(/<[a-z/]|&[a-z#0-9]+;/i);
    }
    expect(promos[2].details).toMatch(/^Sichere dir jeden Montag deine WildcardBet/);
  });

  it("gives a near end, not one years away, and leaves out a campaign not started or over", () => {
    const banner = { textLine1: "Quotenboost", locations: ["promotion.filter.sports"] };
    const promos = parseAdmiralbetBanners(
      [
        { campaign: { id: 1, scheduledTime: "2026-10-20T00:00:00Z", endTime: "2026-11-02T22:59:00Z" }, actions: [{ banner }] },
        { campaign: { id: 2, scheduledTime: "2026-11-01T00:00:00Z", endTime: "2026-11-30T22:59:00Z" }, actions: [{ banner }] },
        { campaign: { id: 3, scheduledTime: "2026-10-01T00:00:00Z", endTime: "2026-10-27T22:59:00Z" }, actions: [{ banner }] },
      ],
      NOW
    );
    expect(promos.map((p) => [p.sourceKey, p.endsAt])).toEqual([["admiralbet:1", "2026-11-02T22:59:00.000Z"]]);
  });

  it("leads to admiralbet.de, the promotions page for a link elsewhere or none", () => {
    expect(bannerUrl("/de/sports?bonus=x")).toBe("https://www.admiralbet.de/de/sports?bonus=x");
    expect(bannerUrl("https://www.admiralbet.de/de/registrieren")).toBe("https://www.admiralbet.de/de/registrieren");
    expect(bannerUrl("https://app.adjust.com/136cciwd")).toBe(ADMIRALBET_PROMOS_URL);
    expect(bannerUrl("https://www.admiralbet.de.example.org/")).toBe(ADMIRALBET_PROMOS_URL);
    expect(bannerUrl("")).toBe(ADMIRALBET_PROMOS_URL);
  });

  it("fails on an answer that is not the list, rather than reading it as no promotion", () => {
    expect(() => parseAdmiralbetBanners({ message: "error" }, NOW)).toThrow("not a list");
  });
});
