import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
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
  verifiedSportNames,
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

  it("maps Unibet's own sport names onto the same keys as Winamax's", () => {
    // Names from its sports menu and its feed (7/10/2026): its rugby is
    // "Rugby" (the union's), its automobile is two sports, Nascar and the F2.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pairs: Array<[string, number]> = [
      ["Rugby", 12],
      ["Nascar", 11],
      ["Formule 2", 11],
      ["Cyclisme", 17],
      ["Formule 1", 40],
      ["Ski Alpin", 43],
      ["Ski de Fond", 46],
      ["Biathlon", 44],
      ["Moto", 190],
      ["Basketball", 2],
    ];
    for (const [unibet, sportId] of pairs) {
      expect(canonicalSport("unibet", unibet), unibet).toBe(canonicalSport("winamax", winamaxSportName(sportId)));
    }
    // Verified sports are silent.
    expect(warn).not.toHaveBeenCalled();
  });

  it("maps Betsson's sports menu names onto the same keys as Winamax's", () => {
    // Names from its sports menu (boNavigationList 1355/top, 8/10/2026), the
    // way ./betsson.ts asks for a sport: its events call American football
    // "American Football", its menu "Foot US".
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pairs: Array<[string, number]> = [
      ["Football", 1],
      ["Tennis", 5],
      ["Basketball", 2],
      ["Hockey sur glace", 4],
      ["Baseball", 3],
      ["Boxe", 10],
      ["Foot US", 16],
      ["Football Australien", 13],
      ["Handball", 6],
      ["Rugby à XV", 12],
      ["Rugby à XIII", 9992],
      ["Snooker", 19],
      ["Volley-ball", 23],
      ["MMA", 117],
      // The sports without head-to-heads.
      ["Formule 1", 40],
      ["Moto", 190],
      ["Golf", 9],
      ["Cyclisme", 17],
    ];
    for (const [betsson, sportId] of pairs) {
      expect(canonicalSport("betsson", betsson), betsson).toBe(canonicalSport("winamax", winamaxSportName(sportId)));
    }
    // Every sport it is read for is covered, and verified sports are silent.
    expect([...pairs.map(([name]) => name), "Badminton", "Tennis de table"].sort()).toEqual(
      [...verifiedSportNames("betsson")].sort()
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("maps PMU's sports list names onto the same keys as Winamax's", () => {
    // Names from its sports list (group.json of the offering API its site reads,
    // 11/10/2026, ./pmu.ts); the winter sports are named by the events' path.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pairs: Array<[string, number]> = [
      ["Football", 1],
      ["Tennis", 5],
      ["Basketball", 2],
      ["Hockey sur glace", 4],
      ["Baseball", 3],
      ["Boxe", 10],
      ["Football américain", 16],
      ["Football australien", 13],
      ["Handball", 6],
      ["Rugby à XV", 12],
      ["Rugby à XIII", 9992],
      ["Snooker", 19],
      ["Volley-ball", 23],
      ["UFC/MMA", 117],
      // The sports without head-to-heads.
      ["Formule 1", 40],
      ["Golf", 9],
      ["Cyclisme", 17],
      ["Ski Alpin", 43],
      ["Biathlon", 44],
    ];
    for (const [pmu, sportId] of pairs) {
      expect(canonicalSport("pmu", pmu), pmu).toBe(canonicalSport("winamax", winamaxSportName(sportId)));
    }
    // Every sport it is read for is covered, and verified sports are silent.
    expect(pairs.map(([name]) => name).sort()).toEqual([...verifiedSportNames("pmu")].sort());
    expect(warn).not.toHaveBeenCalled();
  });

  it("maps Genybet's pages onto the same keys as NetBet's, which share a platform", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const page of verifiedSportNames("sportnco")) {
      expect(canonicalSport("genybet", page), page).toBe(canonicalSport("netbet", page));
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("maps CircusBet's and DAZN Bet's sports like Vbet's, on the same Swarm server", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const alias of verifiedSportNames("vbet")) {
      expect(canonicalSport("circusbet", alias), alias).toBe(canonicalSport("vbet", alias));
      expect(canonicalSport("daznbet", alias), alias).toBe(canonicalSport("vbet", alias));
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("maps Betify's sport names, lower case ones included, onto the shared keys, silently", () => {
    // The names of Betby's feed (14/10/2026), in the case it writes them.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sports: Array<[betify: string, canonical: string]> = [
      ["Football", "football"],
      ["tennis", "tennis"],
      ["Basketball", "basketball"],
      ["Hockey sur glace", "hockey sur glace"],
      ["baseball", "baseball"],
      ["Football américain", "football américain"],
      ["Football Australien", "football australien"],
      ["Arts martiaux mixtes", "mma"],
      ["Rugby à 13", "rugby à xiii"],
      ["Rugby à XV", "rugby à xv"],
      ["badminton", "badminton"],
      // The races: its sports of races are the canonical ones, Nascar and the F2 an automobile.
      ["Cyclisme", "cyclisme"],
      ["course de motos", "moto"],
      ["Nascar", "automobile"],
      ["Formule 2", "automobile"],
      ["course de voitures de tourisme", "automobile"],
      ["Cross-country", "ski de fond"],
      ["Saut à ski", "saut à ski"],
      ["Golf", "golf"],
      // The sports only it lists, under the lower case of its own name.
      ["Echecs", "echecs"],
      ["Fléchettes", "fléchettes"],
      ["Tennis de padel", "tennis de padel"],
    ];
    for (const [betify, canonical] of sports) expect(canonicalSport("betify", betify), betify).toBe(canonical);
    for (const name of verifiedSportNames("betify")) expect(canonicalSport("betify", name), name).toBeTruthy();
    expect(warn).not.toHaveBeenCalled();
  });

  it("puts the sports that only some bookmakers list under one key each, silently", () => {
    // Badminton and table tennis (Winamax ids 31 and 20, which its catalog
    // fixture predates), judo's winner, volleyball at NetBet (8/10/2026).
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sports: Array<[canonical: string, names: Array<[Parameters<typeof canonicalSport>[0], string]>]> = [
      [
        "badminton",
        [
          ["winamax", "Badminton"],
          ["betclic", "badminton"],
          ["vbet", "Badminton"],
          ["netbet", "/badminton"],
          ["unibet", "Badminton"],
          ["betsson", "Badminton"],
        ],
      ],
      [
        "tennis de table",
        [
          ["winamax", "Tennis de table"],
          ["betclic", "table_tennis"],
          ["vbet", "TableTennis"],
          ["netbet", "/tennis-de-table"],
          ["unibet", "Tennis de Table"],
          ["betsson", "Tennis de table"],
        ],
      ],
      [
        "judo",
        [
          ["winamax", "Judo"],
          ["betclic", "judo"],
          ["unibet", "Judo"],
        ],
      ],
      ["volley-ball", [["netbet", "/volleyball"]]],
    ];
    for (const [canonical, names] of sports) {
      for (const [bookmaker, name] of names) expect(canonicalSport(bookmaker, name), `${bookmaker} ${name}`).toBe(canonical);
    }
    expect(warn).not.toHaveBeenCalled();
    expect(OUTRIGHT_SPORTS.has("judo")).toBe(true);
    expect(OUTRIGHT_SPORTS.has("badminton")).toBe(false);
  });

  it("puts the winners of the sports without head-to-heads that Vbet and NetBet list under the shared keys", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const winamax = (id: number) => canonicalSport("winamax", winamaxSportName(id));
    expect(canonicalSport("vbet", "Cycling")).toBe(winamax(17));
    expect(canonicalSport("vbet", "Biathlon")).toBe(winamax(44));
    // Nascar and the Formula 2 are Winamax's "Automobile".
    expect(canonicalSport("vbet", "Nascar")).toBe(winamax(11));
    expect(canonicalSport("vbet", "AutoRacing")).toBe(winamax(11));
    expect(canonicalSport("netbet", "/cyclisme")).toBe(winamax(17));
    expect(canonicalSport("netbet", "/moto")).toBe(winamax(190));
    expect(canonicalSport("netbet", "/ski-alpin")).toBe(winamax(43));
    expect(canonicalSport("netbet", "/biathlon")).toBe(winamax(44));
    // /sport-automobile is the F1's, the F2's and Nascar's page: the Formula 1
    // is told apart by its section (src/scraper/sportnco.ts).
    expect(canonicalSport("netbet", "/sport-automobile")).toBe(winamax(11));
    expect(canonicalSport("netbet", "/formule-1")).toBe(winamax(40));
    expect(warn).not.toHaveBeenCalled();
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

  it("keep every competition Vbet lists but its NBA division, conference and extra markets", () => {
    // The ~80 games without a second team of Vbet's football, tennis and basketball (5 to 9/10/2026).
    const titles: string[] = [];
    for (const alias of ["Soccer", "Tennis", "Basketball"]) {
      const reply = JSON.parse(gunzipSync(readFileSync(join(__dirname, `fixtures/vbet-${alias}.json.gz`))).toString());
      for (const sport of Object.values<any>(reply.data.data.sport)) {
        for (const region of Object.values<any>(sport.region)) {
          for (const competition of Object.values<any>(region.competition)) {
            for (const game of Object.values<any>(competition.game ?? {})) {
              if (!game.team2_name) titles.push(String(game.team1_name).trim());
            }
          }
        }
      }
    }
    expect(titles.length).toBeGreaterThan(70);
    expect(titles.filter((title) => !isCompetitionWinnerTitle(title)).sort()).toEqual([
      "NBA 2026/2027. Marchés supplémentaires",
      "NBA 2026/2027. Vainqueur de la Conférence",
      "NBA 2026/2027. Vainqueur de la division",
    ]);
  });
});
