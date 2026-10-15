import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { BetssonEvent, betssonScraper, fractionalToDecimal, parseBetssonEvents } from "../../src/scraper/betsson";

// Real captures of Betsson's content service (velsv-bson-ssb-pr.betsson.fr,
// 8/10/2026), trimmed: the events of a sport's list (eventListBySportTypeDate),
// as the page returns them -- football (3 matches and one whose result market
// is not offered), basketball, rugby union (a match and an outright), tennis (a
// match already started, without markets, and a priced one) -- and the sports
// menu (boNavigationList 1355/top) without its children.
const LISTS: Record<"football" | "basketball" | "rugby" | "tennis", BetssonEvent[]> = JSON.parse(
  readFileSync(join(__dirname, "fixtures/betsson-event-list.json"), "utf8")
);
const NAVIGATION = JSON.parse(readFileSync(join(__dirname, "fixtures/betsson-navigation.json"), "utf8"));
// The same service's lists for the sports without matches (8/10/2026): the
// Singapore Grand Prix's five sessions and the drivers' title for Formula 1, the
// Indonesia Grand Prix and the title for MotoGP. Each event's markets are
// trimmed to a few, the winner's among them.
const OUTRIGHTS: Record<"formula1" | "motogp", BetssonEvent[]> = JSON.parse(
  gunzipSync(readFileSync(join(__dirname, "fixtures/betsson-outrights.json.gz"))).toString()
);
// The sports as the menu names them, which is how they are asked for.
const FOOTBALL = "Football";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("fractionalToDecimal", () => {
  it("turns the fractional price the API gives into the decimal one the site shows", () => {
    expect(fractionalToDecimal("61", "20")).toBe(4.05);
    expect(fractionalToDecimal("22", "25")).toBe(1.88);
    expect(fractionalToDecimal("8", "25")).toBe(1.32);
  });

  it("does not leave floating-point dust on a price", () => {
    // 57 / 100 + 1 is 1.5699999999999998 in floating point, 107 / 100 + 1 is 2.0700000000000003.
    expect(fractionalToDecimal("57", "100")).toBe(1.57);
    expect(fractionalToDecimal("107", "100")).toBe(2.07);
  });

  it("is NaN when the outcome has no price", () => {
    expect(fractionalToDecimal(undefined, undefined)).toBeNaN();
    expect(fractionalToDecimal(null, "20")).toBeNaN();
    expect(fractionalToDecimal("61", "0")).toBeNaN();
    expect(fractionalToDecimal("abc", "20")).toBeNaN();
  });
});

describe("parseBetssonEvents", () => {
  it("reads a football match as a 1X2 market, its teams, start and id", () => {
    const [saoura] = parseBetssonEvents(LISTS.football, FOOTBALL);
    expect(saoura).toEqual({
      sport: "football",
      competition: "Ligue 1 - Algérie",
      startTime: "2026-10-08T17:00:00.000Z",
      participants: ["JS Saoura", "Olympique Akbou"],
      odds: [
        { market: "1X2", selection: "JS Saoura", price: 1.88 },
        { market: "1X2", selection: "Match nul", price: 2.77 },
        { market: "1X2", selection: "Olympique Akbou", price: 4.05 },
      ],
      sourceId: "4300591.1",
    });
  });

  it("names the teams the way the market's selections do, not the way the match's title does", () => {
    // The title is "FC CFR 1907 Cluj vs FC Universitatea Cluj".
    const cluj = parseBetssonEvents(LISTS.football, FOOTBALL).find((e) => e.sourceId === "4296200.1")!;
    expect(cluj.participants).toEqual(["CFR Cluj", "FC Universitatea Cluj"]);
    expect(cluj.odds.map((o) => o.selection)).toEqual(["CFR Cluj", "Match nul", "FC Universitatea Cluj"]);
  });

  it("reads the result market, not the handicap or the total listed after it", () => {
    const cluj = parseBetssonEvents(LISTS.football, FOOTBALL).find((e) => e.sourceId === "4296200.1")!;
    expect(cluj.odds).toHaveLength(3);
  });

  it("leaves out a match whose result is not offered, whatever market is left", () => {
    // "Central African Republic vs Algeria" lists a Total only: its two
    // outcomes would read as a winner's.
    const events = parseBetssonEvents(LISTS.football, FOOTBALL);
    expect(events).toHaveLength(3);
    expect(events.some((e) => e.sourceId === "4301803.1")).toBe(false);
  });

  it("labels a two-way market as match winner, overtime included or not", () => {
    const [bayern] = parseBetssonEvents(LISTS.basketball, "Basketball");
    expect(bayern).toMatchObject({ sport: "basketball", participants: ["Bayern Munich", "Virtus Bologne"] });
    expect(bayern.odds.map((o) => o.market)).toEqual(["Vainqueur du match", "Vainqueur du match"]);
    expect(bayern.odds.map((o) => o.price)).toEqual([1.32, 2.9]);

    const [sakamoto] = parseBetssonEvents(LISTS.tennis, "Tennis");
    expect(sakamoto).toMatchObject({ sport: "tennis", participants: ["Sakamoto, Rei", "Rublev, Andrey"] });
    expect(sakamoto.odds.map((o) => o.price)).toEqual([3.1, 1.32]);
  });

  it("puts the sport's menu name on the shared key", () => {
    expect(parseBetssonEvents(LISTS.rugby, "Rugby à XV")[0].sport).toBe("rugby à xv");
  });

  it("takes the sport from the menu's name, not from the events' own", () => {
    // American football's events call it "American Football", its menu "Foot US".
    expect(parseBetssonEvents(LISTS.basketball, "Foot US")[0].sport).toBe("football américain");
  });

  it("writes the competition without the line break Betsson ends it with", () => {
    const [match] = structuredClone(LISTS.football);
    match.tournamentname = "Brasileiro Serie A - Brésil\r\n";
    expect(parseBetssonEvents([match], FOOTBALL)[0].competition).toBe("Brasileiro Serie A - Brésil");
  });

  it("leaves out a match already started, which has no markets left", () => {
    expect(parseBetssonEvents(LISTS.tennis, "Tennis").map((e) => e.sourceId)).toEqual(["4301363.1"]);
  });

  it("reads the outrights of the sports with head-to-heads as their competitions' winners", () => {
    const events = parseBetssonEvents(LISTS.rugby, "Rugby à XV");
    expect(events).toHaveLength(2);
    expect(events[0].participants).toEqual(["US Montalbanaise", "CA Brive"]);
    // The NPC, a New Zealand competition: its title the only participant.
    expect(events[1]).toMatchObject({ sport: "rugby à xv", participants: ["National Provincial Championship 2026"] });
    expect(new Set(events[1].odds.map((o) => o.market))).toEqual(new Set(["Vainqueur"]));
    expect(events[1].odds.length).toBeGreaterThan(1);
  });

  it("ignores the entries that close a page, whatever their shape", () => {
    const page = [...LISTS.football, "eventListBySportTypeDate", null] as unknown as BetssonEvent[];
    expect(parseBetssonEvents(page, FOOTBALL)).toHaveLength(3);
  });

  it("skips an event whose start time is malformed without losing the others", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = structuredClone(LISTS.football);
    broken[0].tsstart = "garbage";
    expect(parseBetssonEvents(broken, FOOTBALL).map((e) => e.sourceId)).toEqual(["4300592.1", "4296200.1"]);
    warn.mockRestore();
  });

  it("skips an event that cannot be read without losing the others", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = structuredClone(LISTS.football);
    broken[0].markets = [{ name: "Résultat", selections: null as never }];
    expect(parseBetssonEvents(broken, FOOTBALL)).toHaveLength(2);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("drops an outcome without a price but keeps the match", () => {
    const suspended = structuredClone(LISTS.football);
    const draw = suspended[0].markets![0].selections[1];
    draw.currentpriceup = null;
    const [saoura] = parseBetssonEvents(suspended, FOOTBALL);
    expect(saoura.odds.map((o) => o.selection)).toEqual(["JS Saoura", "Olympique Akbou"]);
  });

  it("returns nothing for an empty page", () => {
    expect(parseBetssonEvents([], FOOTBALL)).toEqual([]);
  });
});

describe("parseBetssonEvents, the outrights of the sports without head-to-heads", () => {
  const formula1 = parseBetssonEvents(OUTRIGHTS.formula1, "Formule 1");
  const byTitle = (title: string) => formula1.find((e) => e.participants[0] === title)!;

  it("reads a Grand Prix session's winner market, titled with the session", () => {
    expect(formula1.map((e) => e.participants[0])).toEqual([
      "Singapore Grand Prix 2026 - Sprint Qualifying",
      "Singapore Grand Prix 2026 - Sprint",
      "Singapore Grand Prix 2026 - Qualification",
      "Singapore Grand Prix 2026 - Race",
      "Formule 1 2026",
    ]);
    const race = byTitle("Singapore Grand Prix 2026 - Race");
    expect(race).toMatchObject({
      sport: "formule 1",
      competition: "Singapore Grand Prix 2026 - Formula 1",
      // 14:00 in Singapore's Paris-time listing, +02:00.
      startTime: "2026-10-11T12:00:00.000Z",
      sourceId: "4299846.1",
    });
    expect(race.odds).toHaveLength(22);
    expect(new Set(race.odds.map((o) => o.market))).toEqual(new Set(["Vainqueur"]));
    expect(race.odds).toContainEqual({ market: "Vainqueur", selection: "Verstappen, Max", price: 2.65 });
  });

  it("reads the winner, in French or in English, not the constructor's, the margin's or the top 3", () => {
    // "Course - Vainqueur", "Qualification - Vainqueur", "... Sprint Race - Winner":
    // each has 22 drivers, where "Constructeur Vainqueur" has 11 teams.
    for (const title of [
      "Singapore Grand Prix 2026 - Sprint Qualifying",
      "Singapore Grand Prix 2026 - Sprint",
      "Singapore Grand Prix 2026 - Qualification",
      "Singapore Grand Prix 2026 - Race",
    ]) {
      const names = byTitle(title).odds.map((o) => o.selection);
      expect(names, title).toHaveLength(22);
      expect(names, title).toContain("Verstappen, Max");
      expect(names, title).not.toContain("Ferrari");
    }
  });

  it("reads the drivers' title for the season, not its duels", () => {
    expect(byTitle("Formule 1 2026").odds.map((o) => o.selection)).toContain("Antonelli, Andrea Kimi");
  });

  it("leaves out the runners Betsson does not price", () => {
    // The drivers' title lists 22 drivers, 6 of them priced.
    expect(byTitle("Formule 1 2026").odds).toHaveLength(6);
  });

  it("reads MotoGP's under the shared moto key", () => {
    const motogp = parseBetssonEvents(OUTRIGHTS.motogp, "Moto");
    expect(motogp.map((e) => [e.sport, e.participants[0]])).toEqual([
      ["moto", "Grand Prix of Indonesia - Race"],
      ["moto", "MotoGP 2026"],
    ]);
    expect(motogp[0].odds).toHaveLength(26);
  });

  it("leaves out an outright without a winner market", () => {
    const race = structuredClone(OUTRIGHTS.formula1[3]);
    race.markets = race.markets!.filter((m) => !/Vainqueur$/.test(m.name ?? "") || /Constructeur/.test(m.name ?? ""));
    expect(parseBetssonEvents([race], "Formule 1")).toEqual([]);
  });

  it("reads a tennis tournament's winner market as a competition's, and leaves out another bet on it", () => {
    const wta: BetssonEvent = { ...LISTS.tennis[1], idfoeventtype: "OUTRIGHT", name: "WTA 1000 Pékin" };
    wta.markets = [
      {
        name: "Vainqueur",
        selections: [
          { name: "Iga Swiatek", currentpriceup: "1", currentpricedown: "1" },
          { name: "Aryna Sabalenka", currentpriceup: "2", currentpricedown: "1" },
        ],
      },
    ];
    expect(parseBetssonEvents([wta], "Tennis")).toMatchObject([
      { sport: "tennis", participants: ["WTA 1000 Pékin"], odds: [{ selection: "Iga Swiatek", price: 2 }, { selection: "Aryna Sabalenka", price: 3 }] },
    ]);
    // A top scorer, not a winner: its title says it.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseBetssonEvents([{ ...wta, name: "Ligue 1 2026/27 - Meilleur buteur" }], "Football")).toEqual([]);
    warn.mockRestore();
  });
});

describe("betssonScraper.fetch", () => {
  const SERVICE = "https://velsv-bson-ssb-pr.betsson.fr/services/content/get";
  const TOKEN = { idfoevent: "_TOKEN_", defaultOrder: 0, listcode: "" };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const contentId = (init?: RequestInit): { type: string; id: string } => JSON.parse(String(init?.body)).contentId;

  // The service as it answers: the sports menu, then a sport's lists by page
  // (football's, tennis's and Formula 1's page 0, then nothing but the closing entry).
  function service(overrides: (id: string) => Response | undefined = () => undefined) {
    return vi.fn(async (_url: string, init?: RequestInit) => {
      const { type, id } = contentId(init);
      const overridden = overrides(id);
      if (overridden) return overridden;
      if (type === "boNavigationList") return json(NAVIGATION);
      if (id.startsWith("FBL/") && id.includes("/0/200/")) return json({ data: LISTS.football });
      if (id.startsWith("TNS/") && id.includes("/0/200/")) return json({ data: LISTS.tennis });
      if (id.startsWith("FO1/") && id.includes("/0/200/")) return json({ data: OUTRIGHTS.formula1 });
      return json({ data: [TOKEN] });
    });
  }

  async function run(fetchMock: ReturnType<typeof service>) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T10:00:00Z"));
    vi.stubGlobal("fetch", fetchMock);
    const promise = betssonScraper.fetch();
    // Rejections are handled by the caller's expect; this keeps them from
    // being reported as unhandled while the timers run.
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    return promise;
  }

  it("reads the sports menu, then each verified sport's matches page by page until an empty one", async () => {
    const fetchMock = service();
    const events = await run(fetchMock);

    const count = (sport: string) => events.filter((e) => e.sport === sport).length;
    expect([count("football"), count("tennis"), count("formule 1"), count("moto")]).toEqual([3, 1, 5, 0]);
    const asked = fetchMock.mock.calls.map(([, init]) => contentId(init));
    expect(asked[0]).toEqual({ type: "boNavigationList", id: "1355/top" });
    // Today to 90 days on, 200 a page, as the site asks for it.
    expect(asked.slice(1).map((c) => `${c.type} ${c.id}`).sort()).toEqual([
      "eventListBySportTypeDate FBL/202610080000/202701062359/0/200/D",
      "eventListBySportTypeDate FBL/202610080000/202701062359/1/200/D",
      "eventListBySportTypeDate FO1/202610080000/202701062359/0/200/D",
      "eventListBySportTypeDate FO1/202610080000/202701062359/1/200/D",
      "eventListBySportTypeDate MCG/202610080000/202701062359/0/200/D",
      "eventListBySportTypeDate TNS/202610080000/202701062359/0/200/D",
      "eventListBySportTypeDate TNS/202610080000/202701062359/1/200/D",
    ]);
  });

  it("posts JSON to the content service, in French, as a desktop browser", async () => {
    const fetchMock = service();
    await run(fetchMock);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(SERVICE);
    expect(init).toMatchObject({ method: "POST" });
    expect(init!.headers).toMatchObject({ "content-type": "application/json" });
    expect(String((init!.headers as Record<string, string>)["user-agent"])).toMatch(/Mozilla\/5\.0/);
    expect(JSON.parse(String(init!.body)).clientContext).toEqual({ language: "FR", ipAddress: "0.0.0.0" });
  });

  it("does not ask for the sports it has no mapping for", async () => {
    const fetchMock = service();
    await run(fetchMock);
    const ids = fetchMock.mock.calls.map(([, init]) => contentId(init).id);
    // Water-polo is a sport of the menu, Padel and "Popular" are not sports at all.
    expect(ids.some((id) => id.startsWith("WAT/"))).toBe(false);
    expect(ids.some((id) => id.startsWith("0/"))).toBe(false);
  });

  it("keeps the other sports' matches when one sport fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const events = await run(service((id) => (id.startsWith("TNS/") ? json({}, 500) : undefined)));
    expect(events.filter((e) => e.sport === "tennis")).toHaveLength(0);
    expect(events.filter((e) => e.sport === "football")).toHaveLength(3);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("keeps a sport's earlier pages when a later one fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const secondFootballPage = (id: string) => id.startsWith("FBL/") && id.includes("/1/200/");
    const events = await run(service((id) => (secondFootballPage(id) ? json({}, 500) : undefined)));
    expect(events.filter((e) => e.sport === "football")).toHaveLength(3);
    warn.mockRestore();
  });

  it("reads a sport without matches as empty, not as a failure", async () => {
    // The service answers 200 and CONTENT_NOT_FOUND where a list has nothing:
    // a sport out of season, a page past the last.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const notFound = (id: string) =>
      json({ errorType: "CONTENT_NOT_FOUND", data: ["eventListBySportTypeDate", id, "ContentServiceImpl.get()"] });
    const events = await run(service((id) => (id.startsWith("TNS/") ? notFound(id) : undefined)));
    expect(events.filter((e) => e.sport === "tennis")).toHaveLength(0);
    expect(events).toHaveLength(8);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("counts any other error the service answers with as the sport failing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = json({ errorType: "INTERNAL_ERROR", data: [] });
    const events = await run(service((id) => (id.startsWith("TNS/") ? failing.clone() : undefined)));
    expect(events).toHaveLength(8);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Tennis"), expect.anything());
    warn.mockRestore();
  });

  it("throws when every sport fails, so the cycle can retry", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(run(service((id) => (/^(FBL|TNS|FO1|MCG)\//.test(id) ? json({}, 500) : undefined)))).rejects.toThrow(
      /every betsson sport failed/
    );
    warn.mockRestore();
  });

  it("throws when the sports menu cannot be read", async () => {
    await expect(run(service((id) => (id === "1355/top" ? json({}, 403) : undefined)))).rejects.toThrow(/403/);
  });

  it("throws when the menu lists none of the sports it reads", async () => {
    const emptyMenu = (id: string) => (id === "1355/top" ? json({ data: { bonavigationnodes: [] } }) : undefined);
    await expect(run(service(emptyMenu))).rejects.toThrow(/sports/);
  });
});
