import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { carouselSlugs, cmsPageUrl, offerTitle, parseMerkurbetsOffer } from "../../src/promos/merkurbets";

// Merkur Bets' CMS as read on 29/10/2026: its promotions page
// (promotions-sportwetten, its content whole) and each offer's page in its
// carousel (their SEO title and description).
const FIXTURE = JSON.parse(readFileSync(join(__dirname, "fixtures/merkurbets-promotions.json"), "utf8"));

describe("Merkur Bets' promotions", () => {
  it("lists the carousel's offers, not those struck out of it nor the page's other links", () => {
    expect(carouselSlugs(FIXTURE.page)).toEqual(["Edeljoker", "gebuehrenfrei-wetten", "apple-pay-bets", "betbuilder", "quickbet", "kombi-boost"]);
  });

  it("gives each offer its title without the site's name, its summary and its page", () => {
    const promos = Object.entries(FIXTURE.pages).map(([slug, page]) => parseMerkurbetsOffer(slug, page as never));
    expect(promos.map((p) => p && [p.title, p.url])).toEqual([
      ["Edeljoker", "https://www.merkurbets.de/de/page/Edeljoker"],
      ["Wetten ohne Gebühr", "https://www.merkurbets.de/de/page/gebuehrenfrei-wetten"],
      ["Apple Pay – Schnell & Sicher Einzahlen", "https://www.merkurbets.de/de/page/apple-pay-bets"],
      ["BETBUILDER", "https://www.merkurbets.de/de/page/betbuilder"],
      ["MEHR TEMPO", "https://www.merkurbets.de/de/page/quickbet"],
      ["KOMBI BOOST: Mehr Gewinn bei Kombiwetten", "https://www.merkurbets.de/de/page/kombi-boost"],
    ]);
    expect(promos[0]).toMatchObject({ sourceKey: "merkurbets:Edeljoker", bookmaker: "merkurbets", details: "Mehr Chancen bei Spielerwetten", endsAt: null });
    expect(promos[1]!.details).toBe("");
  });

  it("drops the site's name from a title either way, and skips a page without one", () => {
    expect(offerTitle("Edeljoker bei MERKUR BETS")).toBe("Edeljoker");
    expect(offerTitle("KOMBI BOOST: Mehr Gewinn | MERKUR BETS")).toBe("KOMBI BOOST: Mehr Gewinn");
    expect(parseMerkurbetsOffer("x", { status: "fail" })).toBeNull();
  });

  it("asks the CMS for a page by its slug, and fails on an answer without the page", () => {
    expect(cmsPageUrl("kombi-boost")).toBe(
      "https://apiv3-msw-mb-de.cashpoint.solutions/api/v1/cms/get?ext_name=ext_api_v1_0&language=de&slug=kombi-boost&type=page&domain=www.merkurbets.de"
    );
    expect(() => carouselSlugs({ status: "fail" })).toThrow("no page");
  });
});
