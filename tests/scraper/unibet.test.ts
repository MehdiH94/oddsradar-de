import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { parseUnibetPage, parseUnibetStart, unibetScraper, UnibetPage } from "../../src/scraper/unibet";

// Real capture of Unibet's upcoming-matches feed (/lvs-api/next/50/...),
// trimmed to a handful of events: 5 football, 2 tennis, 1 American football,
// 1 handball, and 1 outright (judo's -57 kg women, eType "R", no participants).
const PAGE: UnibetPage = JSON.parse(readFileSync(join(__dirname, "fixtures/unibet-next-page.json"), "utf8"));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("parseUnibetStart", () => {
  it("reads YYMMDDHHmm as UTC", () => {
    expect(parseUnibetStart("2610060015")).toBe("2026-10-06T00:15:00.000Z");
  });

  it("rejects anything else", () => {
    expect(() => parseUnibetStart("2026-10-06")).toThrow();
  });
});

describe("parseUnibetPage", () => {
  const events = parseUnibetPage(PAGE);
  const byFirst = (name: string) => events.find((e) => e.participants[0] === name)!;

  it("keeps the head-to-head events and the judo's winner, the one sport with outrights it has", () => {
    expect(events).toHaveLength(10);
    expect(events.filter((e) => e.participants.length === 1).map((e) => e.sport)).toEqual(["judo"]);
  });

  it("reads a judo category's winner market, under the shared judo key", () => {
    const judo = events.find((e) => e.sport === "judo")!;
    expect(judo).toMatchObject({ participants: ["-57kg F"], competition: "-57 kg F", sourceId: "e3385863" });
    expect(new Set(judo.odds.map((o) => o.market))).toEqual(new Set(["Vainqueur"]));
    expect(judo.odds).toContainEqual({ market: "Vainqueur", selection: "Eteri Liparteliani", price: 2.75 });
  });

  it("maps a football match to a 1X2 market with Unibet's draw label", () => {
    const e = byFirst("CS Trinidense");
    expect(e.sport).toBe("football");
    expect(e.participants).toEqual(["CS Trinidense", "Sp.Luqueno"]);
    // The id its markets are asked for by (./unibetMarkets.ts).
    expect(e.sourceId).toMatch(/^e\d+$/);
    expect(e.startTime).toBe("2026-10-05T20:00:00.000Z");
    expect(e.odds.map((o) => o.market)).toEqual(["1X2", "1X2", "1X2"]);
    expect(e.odds.map((o) => o.selection)).toEqual(expect.arrayContaining(["CS Trinidense", "N", "Sp.Luqueno"]));
    for (const o of e.odds) expect(o.price).toBeGreaterThan(1);
  });

  it("turns French decimal prices into numbers", () => {
    const e = byFirst("CS Trinidense");
    const prices = e.odds.map((o) => o.price);
    expect(prices.every((p) => typeof p === "number" && Number.isFinite(p))).toBe(true);
  });

  it("labels a two-way market as match winner", () => {
    const e = byFirst("D.Snigur");
    expect(e.sport).toBe("tennis");
    expect(e.odds.map((o) => o.market)).toEqual(["Vainqueur du match", "Vainqueur du match"]);
  });

  it("maps Unibet's own sport names onto the shared keys", () => {
    expect(byFirst("NO Saints").sport).toBe("football américain");
    // Not in the verified table: kept lowercased so it can still match by name.
    expect(byFirst("RD Slovan").sport).toBe("handball");
  });

  it("skips an event whose start time is malformed without losing the others", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = structuredClone(PAGE);
    const firstEvent = Object.entries(broken.items!).find(([id]) => id.startsWith("e"))!;
    firstEvent[1].start = "garbage";
    expect(parseUnibetPage(broken)).toHaveLength(9);
    warn.mockRestore();
  });

  it("drops a suspended outcome (null price) but keeps the event", () => {
    const suspended = structuredClone(PAGE);
    const draw = Object.values(suspended.items!).find((i) => i.desc === "N")!;
    draw.price = null;
    const events = parseUnibetPage(suspended);
    expect(events).toHaveLength(10);
    expect(events.some((e) => e.odds.length === 2 && e.odds.every((o) => o.selection !== "N"))).toBe(true);
  });

  it("returns nothing for an empty page", () => {
    expect(parseUnibetPage({})).toEqual([]);
  });
});

// Real capture of Unibet's upcoming-matches feed (9/10/2026), trimmed to two
// basketball matches: a Euroleague one, whose one market is the result in
// regular time ("1 N 2", period "Temps réglementaire"), and a BNXT League one,
// whose one market is a two-way "Face à Face" in regular time too.
const BASKETBALL: UnibetPage = JSON.parse(readFileSync(join(__dirname, "fixtures/unibet-basketball-page.json"), "utf8"));

describe("parseUnibetPage, basketball", () => {
  const events = parseUnibetPage(BASKETBALL);
  const byFirst = (name: string) => events.find((e) => e.participants[0] === name)!;

  it("reads the result in regular time as the 1X2, the draw being Unibet's N", () => {
    const e = byFirst("Olympiakos");
    expect(e.sport).toBe("basketball");
    expect(e.sourceId).toBe("e3375680");
    expect(e.odds.map((o) => o.market)).toEqual(["1X2", "1X2", "1X2"]);
    expect(e.odds.map((o) => o.selection).sort()).toEqual(["Anadolu Efes", "N", "Olympiakos"]);
  });

  it("does not call a two-way market in regular time the winner of the match, overtime included", () => {
    // Unibet's winner, overtime included, is in the match's markets
    // (unibetMarkets.ts): the others list it, and are compared with it.
    const e = byFirst("Cb Liege");
    expect(e.sourceId).toBe("e3384954");
    expect(new Set(e.odds.map((o) => o.market))).toEqual(new Set(["Face à Face (temps réglementaire)"]));
  });
});

// Real capture of Unibet's golf feed (/lvs-api/next/50/p237, 6/10/2026): 8
// tournaments (eType "R"), each with one market, "Vainqueur".
const GOLF: UnibetPage = JSON.parse(
  gunzipSync(readFileSync(join(__dirname, "fixtures/unibet-golf-page.json.gz"))).toString()
);

describe("parseUnibetPage, golf tournaments", () => {
  const events = parseUnibetPage(GOLF);
  const byTitle = (title: string) => events.find((e) => e.participants[0] === title)!;

  it("reads each tournament as a winner market titled by the tournament", () => {
    expect(events.map((e) => e.participants[0])).toEqual(
      expect.arrayContaining(["Baycurrent Classic 2026", "Open d'Espagne 2026", "US Masters 2027", "Ryder Cup 2027"])
    );
    expect(events).toHaveLength(8);
    const baycurrent = byTitle("Baycurrent Classic 2026");
    expect(baycurrent).toMatchObject({
      sport: "golf",
      competition: "Baycurrent Classic",
      startTime: "2026-10-10T23:00:00.000Z",
      participants: ["Baycurrent Classic 2026"],
      // The id its markets are asked for by (./unibetMarkets.ts).
      sourceId: "e3386187",
    });
    expect(baycurrent.odds).toHaveLength(72);
    expect(new Set(baycurrent.odds.map((o) => o.market))).toEqual(new Set(["Vainqueur"]));
    expect(baycurrent.odds).toContainEqual({ market: "Vainqueur", selection: "X. Schauffele", price: 9.5 });
  });

  it("leaves out the runners Unibet hides or does not price", () => {
    // Open d'Espagne lists 138 runners, 132 of them priced and shown; the
    // Masters 180, of which 55 are (one more is priced but hidden).
    expect(byTitle("Open d'Espagne 2026").odds).toHaveLength(132);
    const masters = byTitle("US Masters 2027");
    expect(masters.odds).toHaveLength(55);
    expect(masters.odds.some((o) => o.selection === "H. English")).toBe(false);
  });

  it("spaces a runner's initials from his name, for the matcher to align him with the other bookmakers'", () => {
    const names = byTitle("Baycurrent Classic 2026").odds.map((o) => o.selection);
    expect(names).toEqual(expect.arrayContaining(["W. Clark", "C. Morikawa", "M-W. Lee", "SJ. Im"]));
    // Written surname first, they are left as they are.
    expect(names).toContain("Bridgeman, Jacob");
    expect(names.some((n) => /^[A-Za-z-]{1,4}\.\S/.test(n))).toBe(false);
  });

  it("keeps a match's own names as they are", () => {
    // The head-to-heads' abbreviations ("Sp.Luqueno") are another matter (src/matcher).
    expect(parseUnibetPage(PAGE).find((e) => e.participants[0] === "CS Trinidense")!.participants[1]).toBe("Sp.Luqueno");
  });

  it("reads the outrights of the sports with head-to-heads as their competitions' winners", () => {
    const tennis = structuredClone(PAGE);
    for (const item of Object.values(tennis.items!)) if (item.path?.Sport === "Judo") item.path.Sport = "Tennis";
    const [winner] = parseUnibetPage(tennis).filter((e) => e.participants.length === 1);
    expect(winner).toMatchObject({ sport: "tennis", participants: ["-57kg F"] });
  });
});

// Real capture of Unibet's feed (/lvs-api/next/50/..., 14/10/2026), trimmed to 15
// outrights (eType "R") of the sports with head-to-heads, runners cut to the first
// twelve of each: leagues, cups, the Slams, and the other bets Unibet lists beside
// them (a field without its favourite, a boost, a half of a season...).
const COMPETITIONS: UnibetPage = JSON.parse(
  gunzipSync(readFileSync(join(__dirname, "fixtures/unibet-competitions-page.json.gz"))).toString()
);

describe("parseUnibetPage, the winners of competitions", () => {
  const events = parseUnibetPage(COMPETITIONS);
  const byTitle = (title: string) => events.find((e) => e.participants[0] === title)!;

  it("reads a competition's winner market as an outright of its sport, titled with the competition", () => {
    expect(byTitle("Ligue 1 26/27")).toMatchObject({
      sport: "football",
      competition: "Ligue 1 McDonalds",
      // The season's end, not the next matchday.
      startTime: "2027-05-30T00:00:00.000Z",
      participants: ["Ligue 1 26/27"],
      sourceId: "e3354588",
    });
    expect(byTitle("Ligue 1 26/27").odds).toHaveLength(12);
    expect(new Set(byTitle("Ligue 1 26/27").odds.map((o) => o.market))).toEqual(new Set(["Vainqueur"]));
    expect(byTitle("NBA 26/27").sport).toBe("basketball");
    expect(byTitle("Roland Garros H 2027").sport).toBe("tennis");
    expect(byTitle("Roland Garros F 2027").sport).toBe("tennis");
    expect(byTitle("TOP 14 2026/27").sport).toBe("rugby à xv");
    expect(byTitle("LNH Starligue 26/27").sport).toBe("handball");
  });

  it("leaves out a winner market of which Unibet shows one runner only, the others being hidden", () => {
    // MLB 2026: 1 of its 30 teams is bettable (14/10/2026).
    expect(events.map((e) => e.participants[0])).not.toContain("MLB 2026");
  });

  it("reads a winner market written with a leading space, or headed by the competition", () => {
    expect(byTitle("Allsvenskan 2026").odds.length).toBeGreaterThan(1);
    expect(byTitle("UEFA Champions League Women 26/27").odds.length).toBeGreaterThan(1);
  });

  it("leaves out the other bets: the field without its favourite, a half of a season, a boost, a qualifier, the multi-scorers", () => {
    const titles = events.map((e) => e.participants[0]);
    // "Vainqueur sans FC Seoul", "Clausura 2026 - Vainqueur", "Boost SA Spurs...", "Equipe qui va se qualifier...", "Plus / Moins But(s)...".
    for (const gone of ["K-League 2026", "Division de Honor 2026", "Paris Trashtalk 26/27", "Coupe du Brésil 2026", "Multibuts EL (15/10)"]) {
      expect(titles, gone).not.toContain(gone);
    }
    expect(events).toHaveLength(9);
  });
});

// Real capture of Unibet's feed for the sports without head-to-heads other than
// golf, and a rugby union match (/lvs-api/next/50/p1300,p2700,..., 7/10/2026),
// trimmed to 17 outrights (eType "R") and 2 matches.
const RACES: UnibetPage = JSON.parse(
  gunzipSync(readFileSync(join(__dirname, "fixtures/unibet-races-page.json.gz"))).toString()
);

describe("parseUnibetPage, races, skiing and the other sports without head-to-heads", () => {
  const events = parseUnibetPage(RACES);
  const byTitle = (title: string) => events.find((e) => e.participants[0] === title)!;

  it("reads a Grand Prix's sessions as winner markets titled with the Grand Prix", () => {
    // Unibet titles them "Course", "Sprint"...: the Grand Prix is the competition.
    expect(events.filter((e) => e.sport === "formule 1").map((e) => e.participants[0])).toEqual(
      expect.arrayContaining([
        "GP SIngapour - Course",
        "GP SIngapour - Sprint",
        "GP SIngapour - Qualification",
        "GP SIngapour - Sprint Qualif",
        "Vainqueur Ch.Monde F1 2026",
      ])
    );
    const race = byTitle("GP SIngapour - Course");
    expect(race).toMatchObject({ sport: "formule 1", competition: "GP SIngapour", startTime: "2026-10-11T12:00:00.000Z" });
    expect(race.odds).toHaveLength(22);
    expect(new Set(race.odds.map((o) => o.market))).toEqual(new Set(["Vainqueur"]));
    expect(race.odds).toContainEqual({ market: "Vainqueur", selection: "M. Verstappen", price: 2.95 });
    // The session's own market ("Vainqueur (Q)" for the qualifying) is its winner's.
    expect(byTitle("GP SIngapour - Qualification").startTime).toBe("2026-10-10T13:00:00.000Z");
    expect(byTitle("GP SIngapour - Qualification").odds).toHaveLength(22);
  });

  it("spaces the initials of a driver's name, two letters or one", () => {
    const names = byTitle("GP SIngapour - Course").odds.map((o) => o.selection);
    expect(names).toEqual(expect.arrayContaining(["AK. Antonelli", "M. Verstappen"]));
  });

  it("leaves out the runners Unibet hides or does not price", () => {
    // The drivers' title lists 22 drivers, 5 of them available.
    expect(byTitle("Vainqueur Ch.Monde F1 2026").odds).toHaveLength(5);
  });

  it("reads the other sports' winners under the shared sport keys", () => {
    const bySport = (sport: string) => events.filter((e) => e.sport === sport).map((e) => e.participants[0]);
    expect(bySport("cyclisme")).toEqual(["Contre la montre / Ch.EuropeH"]);
    expect(bySport("ski alpin")).toEqual(["Géant F / Soelden"]);
    expect(bySport("biathlon")).toEqual(["Relais H / Classement Général 2026/2027"]);
    expect(bySport("ski de fond")).toEqual(["Tour de Ski 2027"]);
    expect(bySport("moto")).toEqual(["Moto GP Saison 2026"]);
  });

  it("puts Nascar and the Formula 2 under automobile, a season titled with its series", () => {
    // Their seasons are all "Saison 2026" there; the series is the competition.
    expect(events.filter((e) => e.sport === "automobile").map((e) => e.participants[0])).toEqual(
      expect.arrayContaining([
        "Bank of America 400",
        "Nascar Cup Series 2026 - Saison 2026",
        "Auto Parts 2026 - Saison 2026",
        "Championnat du monde F2 2026",
      ])
    );
    // The Formula 2's market is "Pilote vainqueur".
    expect(byTitle("Championnat du monde F2 2026").odds).toHaveLength(4);
  });

  it("leaves out the markets that are not the winner's", () => {
    // "Vainqueur sans X" (Moto3, a cross-country sprint) and a cyclist head-to-head
    // ("Face à Face (Annulé si aucun des 2 n'est dans le Top 10)").
    const titles = events.map((e) => e.participants[0]);
    expect(titles).not.toContain("Moto 3 Saison 2026");
    expect(titles).not.toContain("Sprint H / Classement Général 2026/2027");
    expect(titles).not.toContain("Contre la montre / Ch.EuropeH / Face à Face");
  });

  it("reads Unibet's rugby as the union's", () => {
    const matches = events.filter((e) => e.participants.length === 2);
    expect(matches.map((e) => e.participants[0])).toEqual(["Montauban", "Northland"]);
    expect(matches.every((e) => e.sport === "rugby à xv")).toBe(true);
  });
});

describe("unibetScraper.fetch", () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("gets a token, pages until an empty page, and sends the token on each page", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/acc/token")) return json({ hsToken: "tok" });
      if (url.includes("pageIndex=0")) return json(PAGE);
      return json({ items: {} });
    });
    vi.stubGlobal("fetch", fetchMock);

    const promise = unibetScraper.fetch();
    await vi.runAllTimersAsync();
    const events = await promise;

    expect(events).toHaveLength(10);
    const pageCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes("/next/50/"));
    expect(pageCalls).toHaveLength(2);
    // Nascar's category (the site's /paris-nascar asks for p4011).
    expect(String(pageCalls[0][0])).toMatch(/\/next\/50\/[^?]*\bp4011\b/);
    for (const [, init] of pageCalls) {
      expect((init as RequestInit).headers).toMatchObject({ "x-lvs-hstoken": "tok" });
    }
  });

  it("renews the token once on a 401 and retries the page", async () => {
    vi.useFakeTimers();
    let tokens = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/acc/token")) return json({ hsToken: `tok${++tokens}` });
      const token = (init?.headers as Record<string, string>)["x-lvs-hstoken"];
      if (token === "tok1") return json({}, 401);
      return url.includes("pageIndex=0") ? json(PAGE) : json({ items: {} });
    });
    vi.stubGlobal("fetch", fetchMock);

    const promise = unibetScraper.fetch();
    await vi.runAllTimersAsync();
    expect(await promise).toHaveLength(10);
    expect(tokens).toBe(2);
  });

  it("throws when the first page is blocked, so the cycle can retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url.endsWith("/acc/token") ? json({ hsToken: "t" }) : json({}, 403)))
    );
    await expect(unibetScraper.fetch()).rejects.toThrow(/403/);
  });

  it("keeps earlier pages when a later one fails", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/acc/token")) return json({ hsToken: "t" });
        return url.includes("pageIndex=0") ? json(PAGE) : json({}, 500);
      })
    );
    const promise = unibetScraper.fetch();
    await vi.runAllTimersAsync();
    expect(await promise).toHaveLength(10);
    warn.mockRestore();
  });
});
