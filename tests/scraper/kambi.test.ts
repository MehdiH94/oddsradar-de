import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KambiListEntry, LEOVEGAS, netOfTax, parseKambiEvents, kambiOddsToDecimal, leovegasScraper } from "../../src/scraper/kambi";

// Real captures of Kambi's offering API (the format of every operator of the
// platform: these are PMU's, eu.offering-api.kambicdn.com/offering/v2018/pmusportsfr, 11/10/2026),
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
  KambiListEntry[]
> = JSON.parse(readFileSync(join(__dirname, "fixtures/pmu-lists.json"), "utf8"));
const SPORTS = JSON.parse(readFileSync(join(__dirname, "fixtures/pmu-sports.json"), "utf8"));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("kambiOddsToDecimal", () => {
  it("turns the thousandths the API gives into the decimal price the site shows", () => {
    expect(kambiOddsToDecimal(1470)).toBe(1.47);
    expect(kambiOddsToDecimal(201000)).toBe(201);
    expect(kambiOddsToDecimal(2060)).toBe(2.06);
  });

  it("is NaN when the outcome has no price", () => {
    expect(kambiOddsToDecimal(undefined)).toBeNaN();
    expect(kambiOddsToDecimal(null)).toBeNaN();
    expect(kambiOddsToDecimal("1470" as unknown as number)).toBeNaN();
  });
});

describe("parseKambiEvents, head-to-heads", () => {
  it("reads a football match as a 1X2 market labelled with the teams and Draw", () => {
    const [quito] = parseKambiEvents(LEOVEGAS, LISTS.football, "football");
    expect(quito).toEqual({
      sport: "football",
      competition: "Liga Pro",
      startTime: "2026-10-11T21:30:00.000Z",
      participants: ["LDU Quito", "Barcelona SC"],
      odds: [
        { market: "1X2", selection: "LDU Quito", price: 1.47 },
        { market: "1X2", selection: "Draw", price: 3.55 },
        { market: "1X2", selection: "Barcelona SC", price: 4.8 },
      ],
      sourceId: "1029144441",
    });
  });

  it("reads the main result market, not the total listed after it", () => {
    const events = parseKambiEvents(LEOVEGAS, LISTS.football, "football");
    for (const event of events) expect(new Set(event.odds.map((o) => o.market))).toEqual(new Set(["1X2"]));
  });

  it("reads a two-way market as match winner, with the players", () => {
    const [alexandrova] = parseKambiEvents(LEOVEGAS, LISTS.tennis, "tennis");
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
    const [galatasaray] = parseKambiEvents(LEOVEGAS, LISTS.basketball, "basketball");
    expect(galatasaray.sport).toBe("basketball");
    expect(galatasaray.odds).toEqual([
      { market: "Vainqueur du match", selection: "Galatasaray S.K.", price: 1.21 },
      { market: "Vainqueur du match", selection: "Bursaspor", price: 3 },
    ]);
  });

  it("reads a regular-time ice hockey result as a 1X2", () => {
    const [rangers] = parseKambiEvents(LEOVEGAS, LISTS.ice_hockey, "ice_hockey");
    expect(rangers.sport).toBe("hockey sur glace");
    expect(rangers.odds.map((o) => [o.market, o.selection, o.price])).toEqual([
      ["1X2", "New York Rangers", 1.48],
      ["1X2", "Draw", 4.4],
      ["1X2", "Vancouver Canucks", 4.5],
    ]);
  });

  it("puts the sports' site names on the shared keys", () => {
    expect(parseKambiEvents(LEOVEGAS, LISTS.ufc_mma, "ufc_mma")[0].sport).toBe("mma");
    expect(parseKambiEvents(LEOVEGAS, LISTS.boxing, "boxing")[0].sport).toBe("boxe");
  });

  it("writes the competition without the space PMU ends some with", () => {
    expect(parseKambiEvents(LEOVEGAS, LISTS.boxing, "boxing")[0].competition).toBe("Prochains Combats");
  });

  it("leaves out a match already started, whose prices are the live ones", () => {
    const started = LISTS.football.filter((x) => x.event.state === "STARTED");
    expect(started).toHaveLength(1);
    expect(parseKambiEvents(LEOVEGAS, started, "football")).toEqual([]);
  });

  it("leaves out a match whose result is not offered in the list, whatever market is left", () => {
    // Rugby league's list carries a handicap only, 11/10/2026.
    expect(parseKambiEvents(LEOVEGAS, LISTS.rugby_league, "rugby_league")).toEqual([]);
  });

  it("drops an outcome without a price but keeps the match", () => {
    const quito = structuredClone(LISTS.football[0]);
    const draw = quito.betOffers![0].outcomes.find((o) => o.type === "OT_CROSS")!;
    delete draw.odds;
    draw.status = "SUSPENDED";
    const [event] = parseKambiEvents(LEOVEGAS, [quito], "football");
    expect(event.odds.map((o) => o.selection)).toEqual(["LDU Quito", "Barcelona SC"]);
  });

  it("skips an event that cannot be read without losing the others", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = { event: null } as unknown as KambiListEntry;
    const events = parseKambiEvents(LEOVEGAS, [broken, LISTS.football[0], null as unknown as KambiListEntry], "football");
    expect(events.map((e) => e.participants[0])).toEqual(["LDU Quito"]);
    warn.mockRestore();
  });

  it("returns nothing for an empty list", () => {
    expect(parseKambiEvents(LEOVEGAS, [], "football")).toEqual([]);
  });
});

describe("parseKambiEvents, the sports without head-to-heads", () => {
  it("reads a golf tournament's finishing position as an outright, titled with the tournament", () => {
    const [masters] = parseKambiEvents(LEOVEGAS, LISTS.golf, "golf");
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
    expect(parseKambiEvents(LEOVEGAS, [tournament, without], "golf").map((e) => e.participants[0])).toEqual([
      "DP World India Championship 2026",
    ]);
  });

  it("reads a Grand Prix's winner, which carries no main tag", () => {
    const [grandPrix] = parseKambiEvents(LEOVEGAS, LISTS.formula_1, "formula_1");
    expect(grandPrix.sport).toBe("formule 1");
    expect(grandPrix.participants).toEqual(["GP des États-Unis 2026"]);
    expect(grandPrix.odds[0]).toEqual({ market: "Vainqueur", selection: "Alexander Albon", price: 1001 });
  });

  it("reads a cycling race's winner", () => {
    const [roubaix] = parseKambiEvents(LEOVEGAS, LISTS.cycling, "cycling");
    expect(roubaix.sport).toBe("cyclisme");
    expect(roubaix.participants).toEqual(["Paris - Roubaix 2027"]);
  });

  it("takes the winter sports' own sport from the event's path", () => {
    const events = parseKambiEvents(LEOVEGAS, LISTS.winter_sports, "winter_sports");
    expect(events.map((e) => [e.sport, e.participants[0]])).toEqual([
      ["ski alpin", "Giant Slalom Men Soelden (FIS World Cup 2026/27)"],
      ["biathlon", "Relais Classement Hommes (Coupe du monde IBU 2026/2027)"],
    ]);
  });

  it("reads the winner market of a sport with head-to-heads as its competition's", () => {
    // A snooker tournament's winner: not the main bet, which is the frame's and the match's.
    const [uk] = parseKambiEvents(LEOVEGAS, LISTS.snooker, "snooker");
    expect(uk).toMatchObject({ sport: "snooker", participants: ["UK Championship 2026"] });
    expect(new Set(uk.odds.map((o) => o.market))).toEqual(new Set(["Vainqueur"]));
    expect(uk.odds.length).toBeGreaterThan(1);
  });

  it("leaves out an outright without a winner market", () => {
    const grandPrix = structuredClone(LISTS.formula_1[0]);
    grandPrix.betOffers = [];
    expect(parseKambiEvents(LEOVEGAS, [grandPrix], "formula_1")).toEqual([]);
  });
});

describe("LeoVegas.de's German offer", () => {
  // A real capture of LeoVegas.de's football list from a German IP (offering
  // code "leode", market DE, names in English, 15/10/2026): its first matches
  // with a main result, as the API returns them.
  const GERMAN: KambiListEntry[] = JSON.parse(readFileSync(join(__dirname, "fixtures/leovegas-de-football.json"), "utf8")).events;

  it("reads every match of the list, its teams in English and the draw as Draw", () => {
    const events = parseKambiEvents(LEOVEGAS, GERMAN, "football");
    expect(events).toHaveLength(GERMAN.length);
    expect(events[1]).toEqual({
      sport: "football",
      competition: "A-League",
      startTime: "2026-10-16T09:00:00.000Z",
      participants: ["Sydney FC", "Western Sydney Wanderers"],
      odds: [
        { market: "1X2", selection: "Sydney FC", price: 2.08 },
        { market: "1X2", selection: "Draw", price: 3.55 },
        { market: "1X2", selection: "Western Sydney Wanderers", price: 3.1 },
      ],
      sourceId: "1028404541",
    });
  });
});

describe("netOfTax", () => {
  it("takes LeoVegas.de's 5% tax off what a price pays for the stake bet, to the thousandth", () => {
    expect(LEOVEGAS.taxOnStake).toBe(0.05);
    expect(netOfTax(LEOVEGAS, 2)).toBe(1.9);
    expect(netOfTax(LEOVEGAS, 3.55)).toBe(3.372);
    expect(netOfTax(LEOVEGAS, NaN)).toBeNaN();
  });
});

describe("leovegasScraper.fetch", () => {
  const BASE = "https://eu.offering-api.kambicdn.com/offering/v2018/leode";
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
    const promise = leovegasScraper.fetch();
    // Rejections are handled by the caller's expect; this keeps them from
    // being reported as unhandled while the timers run.
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    return promise;
  }

  it("is LeoVegas.de's scraper, on its own operator's code", () => {
    expect(leovegasScraper.id).toBe("leovegas");
    expect(LEOVEGAS.offering).toBe("leode");
  });

  it("reads the sports list, then the list of each verified sport", async () => {
    const fetchMock = api();
    const events = await run(fetchMock);
    // The prices stored are net of the tax: Quito's 1.47 as read.
    expect(events.find((e) => e.participants[0] === "LDU Quito")?.odds[0].price).toBe(1.396);

    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls[0]).toContain(`${BASE}/group.json`);
    expect(urls.some((url) => url.includes("/listView/football.json"))).toBe(true);
    expect(urls.some((url) => url.includes("/listView/winter_sports.json"))).toBe(true);
    // Voile (sailing) is not a sport this project reads.
    expect(urls.some((url) => url.includes("/listView/sailing.json"))).toBe(false);
    for (const url of urls) {
      expect(url).toContain("lang=en_GB");
      expect(url).toContain("market=DE");
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
    await expect(run(api((url) => (url.includes("/listView/") ? json({}, 500) : undefined)))).rejects.toThrow(/every leovegas sport failed/);
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
