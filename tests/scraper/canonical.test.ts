import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canonicalMarketName,
  canonicalSport,
  COMPETITION_WINNER_SPORTS,
  hasOutrights,
  isCompetitionWinnerTitle,
  MARKET_1X2,
  MARKET_MATCH_WINNER,
  OUTRIGHT_SPORTS,
} from "../../src/scraper/canonical";
import { BETCLIC_SPORT_SLUGS } from "../../src/scraper/betclic";

// Real Winamax sport catalog: the `sportIds` + `sports` entries of the
// PRELOADED_STATE embedded in the pre-migration Winamax listing-page capture
// (git show 7854191:tests/scraper/fixtures/winamax.html), trimmed to
// sportName. It is the same `sports` shape the Socket.IO feed returns
// (compare winamax-sport1-snapshot.json), and its sportIds are exactly the
// ones the live "home" route returned in winamax-home-snapshot.json (minus
// the 100000 pseudo-sport). Nothing here is hand-written.
const WINAMAX_SPORTS: { sportIds: number[]; sports: Record<string, { sportName: string }> } = JSON.parse(
  readFileSync(join(__dirname, "fixtures/winamax-sports-catalog.json"), "utf8")
);

function winamaxSportName(sportId: number): string {
  return WINAMAX_SPORTS.sports[String(sportId)].sportName;
}

describe("canonicalMarketName", () => {
  it("labels a 3-outcome market 1X2 and a 2-outcome market with the shared match-winner label", () => {
    expect(canonicalMarketName(3)).toBe("1X2");
    expect(MARKET_1X2).toBe("1X2");
    expect(canonicalMarketName(2)).toBe("Vainqueur du match");
    expect(MARKET_MATCH_WINNER).toBe("Vainqueur du match");
  });

  it("never labels a market with another outcome count as 1X2 or match-winner", () => {
    for (const n of [0, 1, 4, 10]) {
      expect(canonicalMarketName(n)).not.toBe(MARKET_1X2);
      expect(canonicalMarketName(n)).not.toBe(MARKET_MATCH_WINNER);
    }
    expect(canonicalMarketName(10)).toBe("Marché à 10 issues");
  });
});

describe("canonicalSport", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps both bookmakers' real identifiers for football onto one key", () => {
    // Winamax: "Football" (every committed Winamax snapshot fixture).
    // Betclic: "football" (every match in betclic-matchservice-response.bin).
    expect(canonicalSport("winamax", winamaxSportName(1))).toBe("football");
    expect(canonicalSport("betclic", "football")).toBe("football");
  });

  it("maps every Betclic slug this project requests onto the same key as its real Winamax counterpart", () => {
    // Winamax sportId -> Betclic slug. Winamax names come from the real
    // catalog fixture; Betclic slugs from BETCLIC_SPORT_SLUGS.
    // A string stands for a Winamax name the catalog fixture predates.
    const pairs: Array<[number | string, string]> = [
      [1, "football"],
      [5, "tennis"],
      [2, "basketball"],
      [4, "ice_hockey"],
      [3, "baseball"],
      [44, "biathlon"],
      [10, "boxing"],
      [17, "cycling"],
      [16, "american_football"],
      [13, "australian_rules"],
      [40, "formula_1"],
      [6, "handball"],
      [9, "golf"],
      [12, "rugby_union"],
      [9992, "rugby_league"],
      [19, "snooker"],
      [23, "volleyball"],
      [43, "alpine_skiing"],
      [46, "cross_country_skiing"],
      [48, "ski_jumping"],
      [190, "motorcycling"],
      [117, "martial_arts"],
      // Betclic splits Winamax's "Automobile" per series.
      [11, "rally"],
      [11, "nascar"],
      [11, "formula_2"],
      ["Badminton", "badminton"],
      ["Tennis de table", "table_tennis"],
      ["Judo", "judo"],
    ];
    // Every requested Betclic sport is covered -- none silently falls back.
    expect(pairs.map(([, slug]) => slug).sort()).toEqual([...BETCLIC_SPORT_SLUGS].sort());

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const [sportId, slug] of pairs) {
      const winamaxName = typeof sportId === "string" ? sportId : winamaxSportName(sportId);
      const fromWinamax = canonicalSport("winamax", winamaxName);
      const fromBetclic = canonicalSport("betclic", slug);
      expect(fromBetclic, `${winamaxName} vs ${slug}`).toBe(fromWinamax);
    }
    // Verified sports are silent.
    expect(warn).not.toHaveBeenCalled();
  });

  it("uses the lowercased Winamax display name as the canonical key, so the French UI shows it as-is", () => {
    expect(canonicalSport("betclic", "ice_hockey")).toBe("hockey sur glace");
    expect(canonicalSport("winamax", winamaxSportName(4))).toBe("hockey sur glace");
    expect(canonicalSport("betclic", "australian_rules")).toBe("football australien");
  });

  it("puts the sports that only some bookmakers list under one key each, silently", () => {
    // Badminton and table tennis (Winamax ids 31 and 20, which its catalog
    // fixture predates) and judo's winner.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sports: Array<[canonical: string, names: Array<[Parameters<typeof canonicalSport>[0], string]>]> = [
      [
        "badminton",
        [
          ["winamax", "Badminton"],
          ["betclic", "badminton"],
        ],
      ],
      [
        "tennis de table",
        [
          ["winamax", "Tennis de table"],
          ["betclic", "table_tennis"],
        ],
      ],
      [
        "judo",
        [
          ["winamax", "Judo"],
          ["betclic", "judo"],
        ],
      ],
      // Darts: LeoVegas.de's (Kambi) and 20bet's (18/10/2026).
      [
        "fléchettes",
        [
          ["leovegas", "darts"],
          ["twentybet", "18"],
        ],
      ],
    ];
    for (const [canonical, names] of sports) {
      for (const [bookmaker, name] of names) expect(canonicalSport(bookmaker, name), `${bookmaker} ${name}`).toBe(canonical);
    }
    expect(warn).not.toHaveBeenCalled();
    expect(OUTRIGHT_SPORTS.has("judo")).toBe(true);
    expect(OUTRIGHT_SPORTS.has("badminton")).toBe(false);
  });

  it("keeps an unmapped sport's own lowercased value instead of dropping it, and warns once per value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // A sport Winamax could add to its catalog tomorrow.
    expect(canonicalSport("winamax", "Fléchettes")).toBe("fléchettes");
    expect(canonicalSport("winamax", "Fléchettes")).toBe("fléchettes");
    expect(canonicalSport("betclic", "some_future_slug")).toBe("some_future_slug");

    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0][0])).toContain("Fléchettes");
    expect(String(warn.mock.calls[1][0])).toContain("some_future_slug");
  });
});

describe("competition winners", () => {
  it("are read in the sports with head-to-heads, and in the races' sports as before", () => {
    for (const sport of ["football", "tennis", "basketball", "hockey sur glace", "rugby à xv", "mma", "snooker"]) {
      expect(COMPETITION_WINNER_SPORTS.has(sport), sport).toBe(true);
      expect(hasOutrights(sport), sport).toBe(true);
    }
    expect(hasOutrights("golf")).toBe(true);
    expect(OUTRIGHT_SPORTS.has("football")).toBe(false);
    expect(COMPETITION_WINNER_SPORTS.has("golf")).toBe(false);
    // Not a sport this reads at all.
    expect(hasOutrights("cricket")).toBe(false);
  });

  it("have a winner market's title, which isn't another bet's", () => {
    for (const title of [
      "Ligue 1 2026/2027",
      "Ligue 1 McDonald's® 2026/27",
      "Primera Division 2026",
      "First Division 2026/2027",
      "Premier Division 2026",
      "UEFA Conference League 2026/2027",
      "Roland-Garros (H) 2027",
      "Wimbledon - Women 2027",
      "National Provincial Championship 2026 - Winner",
      "TotalEnergies Open 2027",
      "TOP 14 2026/27",
    ]) {
      expect(isCompetitionWinnerTitle(title), title).toBe(true);
    }
    for (const title of [
      "NBA 2026/2027. Vainqueur de la Conférence",
      "NBA 2026/2027. Vainqueur de la division",
      "NBA 2026/2027. Marchés supplémentaires",
      "Ligue 1 2026/2027 - Meilleur buteur",
      "Premier League 2026/27 - Top 4",
      "Serie A 2026/27 Relegation",
      "Eastern Conference 2026/27",
      "Premier League Winner without Erling Haaland 2026",
      "Euro 2028 Groupe A",
      "NBA Cup 2026 - Conférence Ouest",
      "NBA Cup 2026 - Conférence Est - Groupe A",
      "NHL 2026/2027 - Vainqueur de la Conférence Est",
      "NFL 2026/2027 - Conférence AFC",
      "MLB - American League 2026",
      "Top 14 - 2026/2027 - Saison réguliére",
      "Top 14 - 2026/2027 - Meilleur marqueur d'essais",
      "Ligue 1 McDonald's® - 2026/2027 - Vainqueur (sans le PSG)",
    ]) {
      expect(isCompetitionWinnerTitle(title), title).toBe(false);
    }
  });

});
