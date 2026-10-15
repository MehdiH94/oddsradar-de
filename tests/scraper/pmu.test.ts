import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PmuListEntry, parsePmuEvents, pmuOddsToDecimal, pmuScraper } from "../../src/scraper/pmu";

// Real captures of the offering API PMU's sports site reads (Kambi,
// eu.offering-api.kambicdn.com/offering/v2018/pmusportsfr, 11/10/2026),
// trimmed: a few events of each sport's list (listView/<sport>.json), as it
// returns them, the outrights cut to their first 10 or 12 runners, and the
// sports list (group.json).
const LISTS: Record<
  | "football"
  | "tennis"
  | "basketball"
  | "ice_hockey"
  | "boxing"
  | "ufc_mma"
  | "rugby_league"
  | "golf"
  | "formula_1"
  | "cycling"
  | "snooker"
  | "winter_sports",
  PmuListEntry[]
> = JSON.parse(readFileSync(join(__dirname, "fixtures/pmu-lists.json"), "utf8"));
const SPORTS = JSON.parse(readFileSync(join(__dirname, "fixtures/pmu-sports.json"), "utf8"));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("pmuOddsToDecimal", () => {
  it("turns the thousandths the API gives into the decimal price the site shows", () => {
    expect(pmuOddsToDecimal(1470)).toBe(1.47);
    expect(pmuOddsToDecimal(201000)).toBe(201);
    expect(pmuOddsToDecimal(2060)).toBe(2.06);
  });

  it("is NaN when the outcome has no price", () => {
    expect(pmuOddsToDecimal(undefined)).toBeNaN();
    expect(pmuOddsToDecimal(null)).toBeNaN();
    expect(pmuOddsToDecimal("1470" as unknown as number)).toBeNaN();
  });
});

describe("parsePmuEvents, head-to-heads", () => {
  it("reads a football match as a 1X2 market labelled with the teams and Match nul", () => {
    const [quito] = parsePmuEvents(LISTS.football, "Football");
    expect(quito).toEqual({
      sport: "football",
      competition: "Liga Pro",
      startTime: "2026-10-11T21:30:00.000Z",
      participants: ["LDU Quito", "Barcelona SC"],
      odds: [
        { market: "1X2", selection: "LDU Quito", price: 1.47 },
        { market: "1X2", selection: "Match nul", price: 3.55 },
        { market: "1X2", selection: "Barcelona SC", price: 4.8 },
      ],
      sourceId: "1029144441",
    });
  });

  it("reads the main result market, not the total listed after it", () => {
    const events = parsePmuEvents(LISTS.football, "Football");
    for (const event of events) expect(new Set(event.odds.map((o) => o.market))).toEqual(new Set(["1X2"]));
  });

  it("reads a two-way market as match winner, with the players", () => {
    const [alexandrova] = parsePmuEvents(LISTS.tennis, "Tennis");
    expect(alexandrova).toEqual({
      sport: "tennis",
      competition: "Wuhan",
      startTime: "2026-10-12T03:00:00.000Z",
      participants: ["Ekaterina Alexandrova", "Leylah Annie Fernandez"],
      odds: [
        { market: "Vainqueur du match", selection: "Ekaterina Alexandrova", price: 1.75 },
        { market: "Vainqueur du match", selection: "Leylah Annie Fernandez", price: 1.9 },
      ],
      sourceId: "1029447871",
    });
  });

  it("reads basketball's moneyline, overtime included", () => {
    const [galatasaray] = parsePmuEvents(LISTS.basketball, "Basketball");
    expect(galatasaray.sport).toBe("basketball");
    expect(galatasaray.odds).toEqual([
      { market: "Vainqueur du match", selection: "Galatasaray S.K.", price: 1.21 },
      { market: "Vainqueur du match", selection: "Bursaspor", price: 3 },
    ]);
  });

  it("reads a regular-time ice hockey result as a 1X2", () => {
    const [rangers] = parsePmuEvents(LISTS.ice_hockey, "Hockey sur glace");
    expect(rangers.sport).toBe("hockey sur glace");
    expect(rangers.odds.map((o) => [o.market, o.selection, o.price])).toEqual([
      ["1X2", "New York Rangers", 1.48],
      ["1X2", "Match nul", 4.4],
      ["1X2", "Vancouver Canucks", 4.5],
    ]);
  });

  it("puts the sports' site names on the shared keys", () => {
    expect(parsePmuEvents(LISTS.ufc_mma, "UFC/MMA")[0].sport).toBe("mma");
    expect(parsePmuEvents(LISTS.boxing, "Boxe")[0].sport).toBe("boxe");
  });

  it("writes the competition without the space PMU ends some with", () => {
    expect(parsePmuEvents(LISTS.boxing, "Boxe")[0].competition).toBe("Prochains Combats");
  });

  it("leaves out a match already started, whose prices are the live ones", () => {
    const started = LISTS.football.filter((x) => x.event.state === "STARTED");
    expect(started).toHaveLength(1);
    expect(parsePmuEvents(started, "Football")).toEqual([]);
  });

  it("leaves out a match whose result is not offered in the list, whatever market is left", () => {
    // Rugby league's list carries a handicap only, 11/10/2026.
    expect(parsePmuEvents(LISTS.rugby_league, "Rugby à XIII")).toEqual([]);
  });

  it("drops an outcome without a price but keeps the match", () => {
    const quito = structuredClone(LISTS.football[0]);
    const draw = quito.betOffers![0].outcomes.find((o) => o.type === "OT_CROSS")!;
    delete draw.odds;
    draw.status = "SUSPENDED";
    const [event] = parsePmuEvents([quito], "Football");
    expect(event.odds.map((o) => o.selection)).toEqual(["LDU Quito", "Barcelona SC"]);
  });

  it("skips an event that cannot be read without losing the others", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = { event: null } as unknown as PmuListEntry;
    const events = parsePmuEvents([broken, LISTS.football[0], null as unknown as PmuListEntry], "Football");
    expect(events.map((e) => e.participants[0])).toEqual(["LDU Quito"]);
    warn.mockRestore();
  });

  it("returns nothing for an empty list", () => {
    expect(parsePmuEvents([], "Football")).toEqual([]);
  });
});

describe("parsePmuEvents, the sports without head-to-heads", () => {
  it("reads a golf tournament's finishing position as an outright, titled with the tournament", () => {
    const [masters] = parsePmuEvents(LISTS.golf, "Golf");
    expect(masters.sport).toBe("golf");
    expect(masters.competition).toBe("Tournoi des Masters");
    expect(masters.startTime).toBe("2027-04-08T11:40:00.000Z");
    expect(masters.participants).toEqual(["Masters Tournament 2027"]);
    expect(masters.sourceId).toBe("1027305366");
    expect(masters.odds).toHaveLength(12);
    expect(masters.odds.slice(0, 2)).toEqual([
      { market: "Vainqueur", selection: "Aaron Rai", price: 201 },
      { market: "Vainqueur", selection: "Adam Scott", price: 81 },
    ]);
  });

  it("leaves out the same field without its favourite, which PMU lists beside the tournament", () => {
    // "DP World India Championship Winner without Rory McIlroy 2026" (14/10/2026): another bet on the
    // tournament's players, not a second tournament.
    const tournament = structuredClone(LISTS.golf[0]);
    const without = structuredClone(LISTS.golf[0]);
    tournament.event.name = "DP World India Championship 2026";
    without.event.id = 1029470108;
    without.event.name = "DP World India Championship Winner without Rory McIlroy 2026";
    expect(parsePmuEvents([tournament, without], "Golf").map((e) => e.participants[0])).toEqual([
      "DP World India Championship 2026",
    ]);
  });

  it("reads a Grand Prix's winner, which carries no main tag", () => {
    const [grandPrix] = parsePmuEvents(LISTS.formula_1, "Formule 1");
    expect(grandPrix.sport).toBe("formule 1");
    expect(grandPrix.participants).toEqual(["GP des États-Unis 2026"]);
    expect(grandPrix.odds[0]).toEqual({ market: "Vainqueur", selection: "Alexander Albon", price: 1001 });
  });

  it("reads a cycling race's winner", () => {
    const [roubaix] = parsePmuEvents(LISTS.cycling, "Cyclisme");
    expect(roubaix.sport).toBe("cyclisme");
    expect(roubaix.participants).toEqual(["Paris - Roubaix 2027"]);
  });

  it("takes the winter sports' own sport from the event's path", () => {
    const events = parsePmuEvents(LISTS.winter_sports, "Sports d'hiver");
    expect(events.map((e) => [e.sport, e.participants[0]])).toEqual([
      ["ski alpin", "Giant Slalom Men Soelden (FIS World Cup 2026/27)"],
      ["biathlon", "Relais Classement Hommes (Coupe du monde IBU 2026/2027)"],
    ]);
  });

  it("reads the winner market of a sport with head-to-heads as its competition's", () => {
    // A snooker tournament's winner: not the main bet, which is the frame's and the match's.
    const [uk] = parsePmuEvents(LISTS.snooker, "Snooker");
    expect(uk).toMatchObject({ sport: "snooker", participants: ["UK Championship 2026"] });
    expect(new Set(uk.odds.map((o) => o.market))).toEqual(new Set(["Vainqueur"]));
    expect(uk.odds.length).toBeGreaterThan(1);
  });

  it("leaves out an outright without a winner market", () => {
    const grandPrix = structuredClone(LISTS.formula_1[0]);
    grandPrix.betOffers = [];
    expect(parsePmuEvents([grandPrix], "Formule 1")).toEqual([]);
  });
});

describe("pmuScraper.fetch", () => {
  const BASE = "https://eu.offering-api.kambicdn.com/offering/v2018/pmusportsfr";
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  // The API as it answers: the sports list, then a sport's list by its term key.
  function api(overrides: (url: string) => Response | undefined = () => undefined) {
    return vi.fn(async (url: string) => {
      const overridden = overrides(url);
      if (overridden) return overridden;
      if (url.startsWith(`${BASE}/group.json`)) return json(SPORTS);
      const sport = /\/listView\/([a-z_0-9]+)\.json/.exec(url)?.[1];
      const events = sport && sport in LISTS ? LISTS[sport as keyof typeof LISTS] : [];
      return json({ events });
    });
  }

  async function run(fetchMock: ReturnType<typeof api>) {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);
    const promise = pmuScraper.fetch();
    // Rejections are handled by the caller's expect; this keeps them from
    // being reported as unhandled while the timers run.
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    return promise;
  }

  it("is PMU's scraper", () => {
    expect(pmuScraper.id).toBe("pmu");
  });

  it("reads the sports list, then the list of each verified sport", async () => {
    const fetchMock = api();
    const events = await run(fetchMock);

    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls[0]).toContain(`${BASE}/group.json`);
    expect(urls.some((url) => url.includes("/listView/football.json"))).toBe(true);
    expect(urls.some((url) => url.includes("/listView/winter_sports.json"))).toBe(true);
    // Voile (sailing) is not a sport this project reads.
    expect(urls.some((url) => url.includes("/listView/sailing.json"))).toBe(false);
    for (const url of urls) {
      expect(url).toContain("lang=fr_FR");
      expect(url).toContain("market=FR");
      expect(url).toContain("client_id=200");
    }
    expect(new Set(events.map((e) => e.sport))).toEqual(
      new Set(["football", "tennis", "basketball", "hockey sur glace", "boxe", "mma", "golf", "formule 1", "cyclisme", "ski alpin", "biathlon", "snooker"])
    );
  });

  it("keeps the other sports when one fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const events = await run(api((url) => (url.includes("/listView/tennis.json") ? json({}, 500) : undefined)));
    const sports = new Set(events.map((e) => e.sport));
    expect(sports.has("tennis")).toBe(false);
    expect(sports.has("football")).toBe(true);
    warn.mockRestore();
  });

  it("throws when every sport fails, so the cycle retries the bookmaker", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(run(api((url) => (url.includes("/listView/") ? json({}, 500) : undefined)))).rejects.toThrow(/every pmu sport failed/);
    warn.mockRestore();
  });

  it("throws when the sports list cannot be read", async () => {
    await expect(run(api((url) => (url.includes("/group.json") ? json({}, 403) : undefined)))).rejects.toThrow(/HTTP 403/);
  });

  it("throws when the sports list holds none of the sports it is read for", async () => {
    await expect(run(api((url) => (url.includes("/group.json") ? json({ group: { groups: [] } }) : undefined)))).rejects.toThrow(
      /none of the sports/
    );
  });
});
