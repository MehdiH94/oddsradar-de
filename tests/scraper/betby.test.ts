import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BETIFY,
  BetbyChunk,
  BetbyEventDescriptions,
  BetbyMarketDescriptions,
  betifyScraper,
  fetchBetby,
  outrightIds,
  parseBetbyApiHost,
  parseBetbyEvents,
} from "../../src/scraper/betby";

// Real captures of the API Betify's sportsbook reads (Betby's, on
// api-h-c7818b61-608.sptpub.com, 14/10/2026), trimmed: a few matches of each
// sport as the prematch feed returns them, with their sports, tournaments and
// categories, and the descriptions of the markets they carry.
const CHUNK: BetbyChunk = JSON.parse(readFileSync(join(__dirname, "fixtures/betify-prematch.json"), "utf8"));
const MARKETS: BetbyMarketDescriptions = JSON.parse(readFileSync(join(__dirname, "fixtures/betify-markets.json"), "utf8"));

// Read just before the first match of the capture starts (1791990000), at the
// moment the capture was taken.
const NOW = 1791985000 * 1000;

// The races and championships of the feed (a winner market of runners), trimmed to
// ten runners, with the names the match's own descriptions give them.
const OUTRIGHTS: BetbyChunk & { details: Record<string, { descriptions: BetbyEventDescriptions }> } = JSON.parse(
  readFileSync(join(__dirname, "fixtures/betify-outrights.json"), "utf8")
);
const outrightNames = () =>
  Object.fromEntries(Object.entries(OUTRIGHTS.details).map(([id, d]) => [id, d.descriptions])) as Record<string, BetbyEventDescriptions>;
const readOutrights = (names: Record<string, BetbyEventDescriptions> = outrightNames()) => parseBetbyEvents([OUTRIGHTS], MARKETS, NOW, names);

const clone = (): BetbyChunk => JSON.parse(JSON.stringify(CHUNK));
const read = (chunk: BetbyChunk = CHUNK) => parseBetbyEvents([chunk], MARKETS, NOW);
const byId = (events: ReturnType<typeof read>, id: string) => events.find((e) => e.sourceId === id);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("parseBetbyApiHost", () => {
  it("finds the API host the renderer script reads the feed from", () => {
    const script = `const r=e=>e||a.p.slice(0,-1),n=r("https://api-h-c7818b61-608.sptpub.com"),o=r("https://files-immutable-4cbc033nbd3.sptpub.com")`;
    expect(parseBetbyApiHost(script)).toBe("https://api-h-c7818b61-608.sptpub.com");
  });

  it("is undefined when the script names none", () => {
    expect(parseBetbyApiHost("window.x=1")).toBeUndefined();
    expect(parseBetbyApiHost("https://files-immutable-4cbc033nbd3.sptpub.com")).toBeUndefined();
  });
});

describe("parseBetbyEvents", () => {
  it("reads a football match as a 1X2 market labelled with the teams and Match nul", () => {
    expect(byId(read(), "2709955966920699947")).toEqual({
      sport: "football",
      competition: "Ligue des Champions UEFA",
      startTime: "2026-10-14T19:00:00.000Z",
      participants: ["Real Betis Balompié", "FC Porto"],
      odds: [
        { market: "1X2", selection: "Real Betis Balompié", price: 2.04 },
        { market: "1X2", selection: "Match nul", price: 3.7 },
        { market: "1X2", selection: "FC Porto", price: 3.4 },
      ],
      sourceId: "2709955966920699947",
    });
  });

  it("reads a tennis match as a two-way winner market", () => {
    const tennis = byId(read(), "2721298890203734061");
    expect(tennis?.sport).toBe("tennis");
    expect(tennis?.odds).toEqual([
      { market: "Vainqueur du match", selection: "Kittay B / Yuzuki T", price: 2.1 },
      { market: "Vainqueur du match", selection: "Reynolds F / Watt J", price: 1.65 },
    ]);
  });

  it("reads the winner of a basketball match, overtime included", () => {
    const basket = byId(read(), "2721817088061743109");
    expect(basket?.sport).toBe("basketball");
    expect(basket?.odds).toEqual([
      { market: "Vainqueur du match", selection: "Promitheas Patras BC", price: 2.32 },
      { market: "Vainqueur du match", selection: "TBB Trier", price: 1.5 },
    ]);
  });

  it("reads an ice hockey match's result in regular time, not its winner overtime included", () => {
    const hockey = byId(read(), "2721854333611286544");
    expect(hockey?.sport).toBe("hockey sur glace");
    expect(hockey?.odds).toEqual([
      { market: "1X2", selection: "MHC Tambov", price: 2.58 },
      { market: "1X2", selection: "Match nul", price: 4.5 },
      { market: "1X2", selection: "MHK Sokol Novocheboksarsk", price: 1.94 },
    ]);
  });

  it("reads a baseball match's winner, extra innings included", () => {
    const baseball = byId(read(), "2722141622111449094");
    expect(baseball?.sport).toBe("baseball");
    expect(baseball?.odds.map((o) => o.price)).toEqual([1.56, 2.38]);
  });

  it("leaves out the winner of a best-of-seven series, which is not the winner of a game", () => {
    // Betby lists a playoff series as a "match" of its own beside the games (captured 15/10/2026):
    // Brewers-Dodgers, its tournament "Résultats de la série MLB (meilleur des 7 matchs)", its winner
    // market (186) priced 1.05 / 8.0 while the game itself was around 1.8 / 2.0.
    const series = clone();
    series.tournaments["2453258939991732250"] = { name: "Résultats de la série MLB (meilleur des 7 matchs)" };
    series.events["2719906950816084007"] = {
      ...series.events["2722141622111449094"],
      desc: {
        ...series.events["2722141622111449094"].desc,
        tournament: "2453258939991732250",
        competitors: [{ name: "Milwaukee Brewers" }, { name: "Los Angeles Dodgers" }],
      },
      markets: { "186": { "": { "4": { k: "1.05" }, "5": { k: "8.0" } } } },
    };
    expect(byId(read(series), "2719906950816084007")).toBeUndefined();
    // The same event under a tournament that is no series is read as any match.
    series.tournaments["2453258939991732250"] = { name: "MLB" };
    expect(byId(read(series), "2719906950816084007")?.odds.map((o) => o.price)).toEqual([1.05, 8]);
    // The WNBA's series is named in English.
    series.tournaments["2453258939991732250"] = { name: "WNBA Series Results (Best of 7 games)" };
    expect(byId(read(series), "2719906950816084007")).toBeUndefined();
    // A league that only has "Series" or "Série" in its name is no series of games.
    for (const name of ["Série A (2x6 min)", "Counter-Strike Pro Series 2026", "Sekai Sumo Basho (Best of 9)"]) {
      series.tournaments["2453258939991732250"] = { name };
      expect(byId(read(series), "2719906950816084007")).toBeDefined();
    }
  });

  it("reads a fight's winner as the match winner, mapping its sport to MMA", () => {
    const fight = byId(read(), "2722137902401327129");
    expect(fight?.sport).toBe("mma");
    expect(fight?.odds.map((o) => o.price)).toEqual([2.39, 1.51]);
  });

  it("reads a rugby union match's 1X2, not the draw-refunded winner listed after it", () => {
    const rugby = byId(read(), "2721108418084610053");
    expect(rugby?.sport).toBe("rugby à xv");
    expect(rugby?.odds).toEqual([
      { market: "1X2", selection: "US Dax", price: 1.34 },
      { market: "1X2", selection: "Match nul", price: 20 },
      { market: "1X2", selection: "US Montalbanaise", price: 3.35 },
    ]);
  });

  it("reads the other sports of matches under their own keys, a chess game's draw included", () => {
    const events = read();
    const chess = byId(events, "2697154140240482342");
    expect(chess?.sport).toBe("echecs");
    expect(chess?.odds.map((o) => o.market)).toEqual(["1X2", "1X2", "1X2"]);
    expect(chess?.odds[1].selection).toBe("Match nul");
    expect(byId(events, "2722041112897400860")?.sport).toBe("tennis de padel");
    expect(byId(events, "2720877666361282564")?.sport).toBe("fléchettes");
    expect(byId(events, "2721361056411824166")?.sport).toBe("floorball");
    expect(byId(events, "2721732301858934831")?.sport).toBe("basket-ball à trois");
    for (const id of ["2722041112897400860", "2720877666361282564", "2721732301858934831"]) {
      expect(byId(events, id)?.odds.map((o) => o.market)).toEqual(["Vainqueur du match", "Vainqueur du match"]);
    }
  });

  it("reads a cricket match's winner, the Super Over included", () => {
    const cricket = byId(read(), "2721744012179550256");
    expect(cricket?.sport).toBe("cricket");
    expect(cricket?.odds.map((o) => o.market)).toEqual(["Vainqueur du match", "Vainqueur du match"]);
  });

  it("leaves out an e-sport, which is not a sport it compares", () => {
    expect(byId(read(), "2718504551748603909")).toBeUndefined();
  });

  it("leaves out a virtual match, a tournament and a match already started", () => {
    const ids = read().map((e) => e.sourceId);
    expect(ids).not.toContain("2722140184652161062");
    expect(ids).not.toContain("2687337623881654274");

    const started = clone();
    started.events["2709955966920699947"].desc.scheduled = NOW / 1000 - 60;
    expect(byId(read(started), "2709955966920699947")).toBeUndefined();
  });

  it("leaves out a match whose price is blocked, rather than reading a part of its 1X2", () => {
    const blocked = clone();
    blocked.events["2709955966920699947"].markets!["1"][""]["2"] = { k: "0.0", b: 1 };
    expect(byId(read(blocked), "2709955966920699947")).toBeUndefined();
    // The others are read all the same.
    expect(byId(read(blocked), "2713755115675856915")).toBeDefined();
  });

  it("leaves out a match without a market it knows how to read, and keeps the rest", () => {
    const bare = clone();
    bare.events["2709955966920699947"].markets = { "60": bare.events["2709955966920699947"].markets!["60"] };
    delete bare.events["2713755115675856915"].markets;
    const ids = read(bare).map((e) => e.sourceId);
    expect(ids).not.toContain("2709955966920699947");
    expect(ids).not.toContain("2713755115675856915");
    expect(ids).toContain("2721298890203734061");
  });

  it("reads the races and championships as winner markets, their runners named by the match's descriptions", () => {
    const events = readOutrights();
    const guangxi = byId(events, "2721226924142764032");
    expect(guangxi).toMatchObject({ sport: "cyclisme", competition: "Tour of Guangxi", participants: ["Tour of Guangxi"] });
    expect(guangxi?.odds).toHaveLength(10);
    expect(guangxi?.odds.every((o) => o.market === "Vainqueur" && o.price > 1 && o.selection.length > 0)).toBe(true);
    expect(guangxi?.startTime).toBe("2026-10-15T03:00:00.000Z");
    // The sports of races are the canonical ones: Nascar is an automobile, a motorbike race a moto.
    expect(byId(events, "2721702455007125529")).toMatchObject({ sport: "automobile", participants: ["Freeway Insurance 500"] });
    expect(byId(events, "2620222091726823459")).toMatchObject({ sport: "moto", participants: ["MotoGP World Championship 2026"] });
    expect(byId(events, "2721086165070516268")).toMatchObject({ sport: "formule 1", participants: ["United States Grand Prix Race"] });
    expect(byId(events, "2655709036779024429")).toMatchObject({ sport: "golf", competition: "The Masters", participants: ["The Masters 2027"] });
    expect(byId(events, "2686556831555395602")).toMatchObject({ sport: "ski alpin", participants: ["World Cup 2026/27 Overall"] });
  });

  it("reads the winner of an outright, not its Top 10, its team's winner nor its round leader", () => {
    const events = readOutrights();
    const nascar = byId(events, "2721702455007125529");
    const winner = OUTRIGHTS.events!["2721702455007125529"].markets!["2000000"];
    const prices = Object.values(Object.values(winner)[0]).map((o) => Number(o.k)).sort((a, b) => a - b);
    expect(nascar?.odds.map((o) => o.price).sort((a, b) => a - b)).toEqual(prices);
    // The golf championship's winner is read all the same, among the markets after it.
    expect(byId(events, "2721752993635639312")?.odds).toHaveLength(10);
  });

  it("reads the winner of a championship the feed calls a free forecast (market 534)", () => {
    const soelden = byId(readOutrights(), "2721408853815210001");
    expect(soelden?.sport).toBe("ski alpin");
    expect(soelden?.odds.every((o) => o.market === "Vainqueur")).toBe(true);
  });

  it("leaves out an outright whose runners it cannot name, and one already started", () => {
    const names = outrightNames();
    delete names["2721226924142764032"];
    expect(byId(readOutrights(names), "2721226924142764032")).toBeUndefined();
    expect(byId(readOutrights(names), "2721702455007125529")).toBeDefined();

    const started: BetbyChunk = JSON.parse(JSON.stringify(OUTRIGHTS));
    started.events!["2721226924142764032"].desc.scheduled = NOW / 1000 - 60;
    expect(byId(parseBetbyEvents([started], MARKETS, NOW, outrightNames()), "2721226924142764032")).toBeUndefined();
  });

  it("asks for the descriptions of the outrights of the sports it reads, and of those only", () => {
    expect(outrightIds([OUTRIGHTS], NOW).sort()).toEqual(Object.keys(OUTRIGHTS.events!).sort());
    // A tournament of football (a cup's winner) is not one.
    const cup: BetbyChunk = JSON.parse(JSON.stringify(CHUNK));
    cup.events!["2687337623881654274"].desc.scheduled = NOW / 1000 + 86400;
    expect(outrightIds([cup], NOW)).toEqual([]);
    // Nor are the matches.
    expect(outrightIds([CHUNK], NOW)).toEqual([]);
  });

  it("merges the chunks of the feed, a match listed twice being read once", () => {
    const events = parseBetbyEvents([CHUNK, CHUNK], MARKETS, NOW);
    expect(events).toHaveLength(read().length);
  });
});

const API = "https://api-h-c7818b61-608.sptpub.com";
const FEED = `${API}/api/v4/prematch/brand/2245581113223421952/fr`;

// A server that answers what Betify's site and Betby's feed do.
function stubServer(overrides: Record<string, () => Response> = {}) {
  const calls: string[] = [];
  const json = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200 });
  const routes: Record<string, () => Response> = {
    "https://flex.betify10.sh/fr/sport/launch": json({
      result: { brand_id: "2245581113223421952", script: "https://betify.sptpub.com/bt-renderer.min.js" },
    }),
    "https://betify.sptpub.com/bt-renderer.min.js": () =>
      new Response(`n=r("${API}"),o=r("https://files-immutable-4cbc033nbd3.sptpub.com")`, { status: 200 }),
    [`${FEED}/0`]: json({ top_events_versions: [11], rest_events_versions: [12] }),
    [`${FEED}/11`]: json(CHUNK),
    [`${FEED}/12`]: json({ ...CHUNK, events: {} }),
    [`${API}/api/v3/descriptions/brand/2245581113223421952/markets/fr`]: json(MARKETS),
    ...overrides,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      const route = routes[url];
      return route ? route() : new Response("not found", { status: 404 });
    })
  );
  return { calls };
}

describe("fetchBetby", () => {
  it("reads the feed through the host the renderer names, and returns the matches", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const { calls } = stubServer();
    const events = await fetchBetby(BETIFY);
    expect(events.map((e) => e.sourceId)).toContain("2709955966920699947");
    expect(calls).toContain(`${FEED}/0`);
    expect(calls).toContain(`${FEED}/11`);
    expect(calls).toContain(`${FEED}/12`);
  });

  it("falls back on the host it knew when the renderer names none", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const { calls } = stubServer({
      "https://betify.sptpub.com/bt-renderer.min.js": () => new Response("window.x=1", { status: 200 }),
    });
    const events = await fetchBetby(BETIFY);
    vi.useRealTimers();
    expect(events.length).toBeGreaterThan(0);
    expect(calls).toContain(`${FEED}/0`);
  });

  it("fails when the feed's version list is not answered, so the cycle is retried", async () => {
    stubServer({ [`${FEED}/0`]: () => new Response("", { status: 503 }) });
    await expect(fetchBetby(BETIFY)).rejects.toThrow(/HTTP 503/);
  });

  it("fails when the market descriptions are not answered", async () => {
    stubServer({
      [`${API}/api/v3/descriptions/brand/2245581113223421952/markets/fr`]: () =>
        new Response("", { status: 500 }),
    });
    await expect(fetchBetby(BETIFY)).rejects.toThrow(/HTTP 500/);
  });

  it("keeps the other chunks when one fails, and fails when every one does", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const partial = stubServer({ [`${FEED}/12`]: () => new Response("", { status: 500 }) });
    expect((await fetchBetby(BETIFY)).length).toBeGreaterThan(0);
    expect(partial.calls).toContain(`${FEED}/12`);

    stubServer({
      [`${FEED}/11`]: () => new Response("", { status: 500 }),
      [`${FEED}/12`]: () => new Response("", { status: 500 }),
    });
    await expect(fetchBetby(BETIFY)).rejects.toThrow(/every/);
    vi.useRealTimers();
  });

  describe("the races and championships", () => {
    const json = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200 });
    const descriptionRoute = (id: string) => `${API}/api/v3/descriptions/brand/2245581113223421952/event/${id}/fr`;
    const withOutrights = (failing: string[] = []) => {
      const overrides: Record<string, () => Response> = {
        [`${FEED}/0`]: json({ top_events_versions: [11], rest_events_versions: [12, 13] }),
        [`${FEED}/13`]: json({ ...OUTRIGHTS, details: undefined }),
      };
      for (const [id, d] of Object.entries(OUTRIGHTS.details)) {
        overrides[descriptionRoute(id)] = failing.includes(id) ? () => new Response("", { status: 500 }) : json(d.descriptions);
      }
      return stubServer(overrides);
    };

    it("asks each one's descriptions for its runners' names, and reads it with the matches", async () => {
      vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
      const { calls } = withOutrights();
      const events = await fetchBetby(BETIFY);
      expect(events.find((e) => e.sourceId === "2721226924142764032")?.participants).toEqual(["Tour of Guangxi"]);
      expect(events.find((e) => e.sourceId === "2709955966920699947")).toBeDefined();
      expect(calls).toContain(descriptionRoute("2721226924142764032"));
      // Nothing is asked for the matches.
      expect(calls).not.toContain(descriptionRoute("2709955966920699947"));
    });

    it("loses only the outright whose descriptions failed", async () => {
      vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      withOutrights(["2721226924142764032"]);
      const events = await fetchBetby(BETIFY);
      expect(events.find((e) => e.sourceId === "2721226924142764032")).toBeUndefined();
      expect(events.find((e) => e.sourceId === "2721702455007125529")).toBeDefined();
      expect(events.find((e) => e.sourceId === "2709955966920699947")).toBeDefined();
      warn.mockRestore();
    });
  });

  it("is registered as the betify scraper", () => {
    expect(betifyScraper.id).toBe("betify");
  });
});
