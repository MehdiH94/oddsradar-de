import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { campaignUrl, parseNeobetCampaigns } from "../../src/promos/neobet";

// neobet's campaigns list as read from the VPS on 28/10/2026 (`vps-report
// promo-samples`): 25 campaigns, five of them the NEO.bet Million's copies
// for one league each.
const CAMPAIGNS = JSON.parse(readFileSync(join(__dirname, "fixtures/neobet-campaigns.json"), "utf8"));

describe("neobet's promotions", () => {
  it("keeps the campaigns of the list, without the player protection, the top winners or the Million's league copies", () => {
    const promos = parseNeobetCampaigns(CAMPAIGNS);
    expect(promos).toHaveLength(18);
    expect(promos.slice(0, 3)).toEqual([
      {
        sourceKey: "neobet:root-freebet",
        bookmaker: "neobet",
        title: "25 € Freiwetten",
        details: "Jetzt 25 € Freiwetten & 100 € Bonus sichern",
        url: "https://neobet.de/de",
        endsAt: null,
      },
      {
        sourceKey: "neobet:profi",
        bookmaker: "neobet",
        title: "Profi Bonus",
        details: "Profi Bonus - 100% bis zu 100€",
        url: "https://neobet.de/de/Bonus/Willkommen",
        endsAt: null,
      },
      expect.objectContaining({ sourceKey: "neobet:starter" }),
    ]);
    const keys = promos.map((p) => p.sourceKey);
    expect(keys).toContain("neobet:millions");
    expect(keys).toContain("neobet:taxFree");
    expect(keys.filter((k) => k.startsWith("neobet:millions-"))).toEqual([]);
    expect(keys).not.toContain("neobet:responsiblegaming");
    expect(keys).not.toContain("neobet:topBets");
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("leaves out a campaign for other countries only", () => {
    const promos = parseNeobetCampaigns([
      { campaignId: "a", name: "Für Kanada", targetGroupDesc: { props: { countries: "CA|ZA" } } },
      { campaignId: "b", name: "Für alle" },
    ]);
    expect(promos.map((p) => p.sourceKey)).toEqual(["neobet:b"]);
  });

  it("leads to the campaign's page on neobet.de, never to the account, the betslip or another site", () => {
    expect(campaignUrl({ link: "/de/Infos/GebuehrenfreiWetten" })).toBe("https://neobet.de/de/Infos/GebuehrenfreiWetten");
    expect(campaignUrl({ link: "", carouselOptions: { primaryLink: "#betslip/Betslip", secondaryLink: "de/Bonus/Willkommen" } })).toBe(
      "https://neobet.de/de/Bonus/Willkommen"
    );
    expect(campaignUrl({ carouselOptions: { primaryLink: "#account/Account" } })).toBe("https://neobet.de/de");
    expect(campaignUrl({ carouselOptions: { secondaryLink: "https://www.example.org/", primaryLink: "/de/Million" } })).toBe("https://neobet.de/de/Million");
    expect(campaignUrl({ link: "https://neobet.de/de/Sportwetten" })).toBe("https://neobet.de/de/Sportwetten");
  });

  it("fails on an answer that is not the list, rather than reading it as no promotion", () => {
    expect(() => parseNeobetCampaigns({ error: "maintenance" })).toThrow("not a list");
  });
});
