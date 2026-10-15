import { describe, it, expect, vi, afterEach } from "vitest";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  fetchSportnco,
  genybetScraper,
  GENYBET,
  NETBET,
  readCompetitions,
  readSportncoEvents,
  readSportncoTournaments,
  SportncoEvent,
} from "../../src/scraper/sportnco";

// Real answers of SportNCo's API (5/10/2026): NetBet's match lists of two
// competitions (component/data) and its football page (component/datatree),
// Genybet's home, tennis and basketball pages (the same platform, the same
// matches as NetBet's).
const load = (name: string): unknown =>
  JSON.parse(gunzipSync(readFileSync(join(__dirname, `fixtures/sportnco-${name}.json.gz`))).toString());

// The matches a page shows (its featured lists), as a competition's list.
function asMatchList(page: unknown): unknown {
  const found = new Map<number, SportncoEvent>();
  const walk = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") {
      const event = node as SportncoEvent;
      if (event.actors && event.markets) found.set(event.id, event);
      else Object.values(node).forEach(walk);
    }
  };
  walk(page);
  return { components: [{ tree_compo_key: "prematch_event_list", data: { events: [...found.values()] } }] };
}

describe("readSportncoEvents", () => {
  it("reads a competition's matches and their result, labelled with the teams' names and the draw", () => {
    const events = readSportncoEvents(load("netbet-ligue-des-nations"), NETBET);
    expect(events).toHaveLength(10);
    expect(events[0]).toEqual({
      sport: "football",
      competition: "Ligue des Nations",
      startTime: "2026-10-06T14:00:00.000Z",
      participants: ["Kazakhstan", "Îles Féroé"],
      odds: [
        { market: "1X2", selection: "Kazakhstan", price: 2.3 },
        { market: "1X2", selection: "Nul", price: 2.92 },
        { market: "1X2", selection: "Îles Féroé", price: 3.1 },
      ],
      sourceId: "12165721",
    });
    expect(readSportncoEvents(load("netbet-euro-u21"), NETBET)).toHaveLength(21);
  });

  it("takes ice hockey's result in regular time, not its winner shoot-out included the site puts first", () => {
    const events = readSportncoEvents(asMatchList(load("genybet-home-page")), GENYBET);
    const hockey = events.filter((e) => e.sport === "hockey sur glace");
    expect(hockey).toHaveLength(4);
    expect(hockey.find((e) => e.participants[0] === "Tampa Bay Lightning")?.odds).toEqual([
      { market: "1X2", selection: "Tampa Bay Lightning", price: 1.61 },
      { market: "1X2", selection: "Nul", price: 4 },
      { market: "1X2", selection: "Philadelphia Flyers", price: 3.55 },
    ]);
    expect(events.filter((e) => e.sport === "baseball").every((e) => e.odds[0].market === "Vainqueur du match")).toBe(
      true
    );
    expect(events.filter((e) => e.sport === "football américain")).toHaveLength(1);
  });

  it("takes a fight's winner, not one refunded on a draw", () => {
    const reply = load("netbet-ligue-des-nations") as { components: { data: { events: SportncoEvent[] } }[] };
    const match = reply.components[0].data.events.find((e) => e.id === 12165721)!;
    const winner = match.markets!.find((m) => m.main === 1)!;
    const fight: SportncoEvent = {
      ...match,
      sport: { url: "/mma" },
      markets: [
        {
          ...winner,
          main: 2,
          selection_order_type: "moneyline",
          bets: [
            {
              label: "Qui va gagner le combat ?",
              selections: [winner.bets![0].selections[0], winner.bets![0].selections[2]],
            },
          ],
        },
      ],
    };
    const [read] = readSportncoEvents(
      { components: [{ tree_compo_key: "prematch_event_list", data: { events: [fight] } }] },
      NETBET
    );
    expect(read).toMatchObject({ sport: "mma", odds: [{ market: "Vainqueur du match", price: 2.3 }, { price: 3.1 }] });

    // NetBet's fights (5/10/2026): a draw is no loss, so not the winner
    // Winamax's and Betclic's are compared on.
    const refunded = structuredClone(fight);
    refunded.markets![0].bets![0].label = "Qui va gagner le combat ? (remboursé si match nul)";
    expect(
      readSportncoEvents(
        { components: [{ tree_compo_key: "prematch_event_list", data: { events: [refunded] } }] },
        NETBET
      )
    ).toEqual([]);
  });

  it("takes a winner overtime included, never a handicap or a half", () => {
    const basketball = readSportncoEvents(asMatchList(load("genybet-basketball-page")), GENYBET);
    expect(basketball).toHaveLength(20);
    expect(basketball.every((e) => e.sport === "basketball" && e.odds.length === 2)).toBe(true);
    const tennis = readSportncoEvents(asMatchList(load("genybet-tennis-page")), GENYBET);
    expect(tennis).toHaveLength(21);
    expect(tennis.every((e) => e.odds[0].market === "Vainqueur du match")).toBe(true);
  });

  it("leaves out a match under way, cancelled, not between two sides, or whose result lacks an outcome", () => {
    const reply = load("netbet-ligue-des-nations") as { components: { data: { events: SportncoEvent[] } }[] };
    const [first, second, third, fourth, fifth] = reply.components[0].data.events;
    const result = first.markets!.find((m) => m.main === 1)!;
    const events = [
      { ...first, state: "live" },
      { ...second, is_canceled: true },
      { ...third, competition: { ...third.competition, display_mode: "outright" } },
      {
        ...fourth,
        markets: [{ ...result, bets: [{ ...result.bets![0], selections: result.bets![0].selections.slice(0, 2) }] }],
      },
      fifth,
    ];
    const read = readSportncoEvents(
      { components: [{ tree_compo_key: "prematch_event_list", data: { events } }] },
      NETBET
    );
    expect(read.map((e) => e.sourceId)).toEqual([String(fifth.id)]);
  });
});

describe("readSportncoTournaments", () => {
  // Real answer to NetBet's golf page, its "final_winner" component
  // (6/10/2026): each tournament is an event with a single market, its winner.
  const golf = () => load("netbet-golf-winners") as { components: { data: { events: SportncoEvent[] } }[] };
  const read = () => readSportncoTournaments(golf(), NETBET);
  const byTitle = (title: string) => read().find((e) => e.participants[0] === title)!;

  it("reads each tournament as a winner market, titled the way the other bookmakers do", () => {
    expect(read().map((e) => e.participants[0])).toEqual([
      "Baycurrent Classic 2026",
      "Open d'Espagne 2026",
      "US Masters 2027",
      "PGA Championship 2027",
      "Ryder Cup 2027",
    ]);
    const baycurrent = byTitle("Baycurrent Classic 2026");
    expect(baycurrent).toMatchObject({
      sport: "golf",
      competition: "Baycurrent Classic",
      startTime: "2026-10-07T23:45:00.000Z",
      sourceId: "12199616",
    });
    expect(baycurrent.odds).toHaveLength(72);
    expect(new Set(baycurrent.odds.map((o) => o.market))).toEqual(new Set(["Vainqueur"]));
    expect(baycurrent.odds).toContainEqual({ market: "Vainqueur", selection: "Xander Schauffele", price: 8.75 });
    expect(byTitle("Open d'Espagne 2026").odds).toHaveLength(132);
    expect(byTitle("Ryder Cup 2027").odds.map((o) => o.selection)).toEqual(["Europe", "Etats-Unis", "Egalité"]);
  });

  it("leaves out a tournament under way or cancelled, or whose market is not its winner", () => {
    const reply = golf();
    const [first, second, third] = reply.components[0].data.events;
    reply.components[0].data.events = [
      { ...first, state: "live" },
      { ...second, is_canceled: true },
      { ...third, markets: [{ ...third.markets![0], bets: [{ ...third.markets![0].bets![0], label: "Top 5" }] }] },
      reply.components[0].data.events[3],
    ];
    expect(readSportncoTournaments(reply, NETBET).map((e) => e.participants[0])).toEqual(["PGA Championship 2027"]);
  });
});

describe("readSportncoTournaments, the sports other than golf", () => {
  // Real answers to the "final_winner" component of NetBet's pages of the
  // automobile, the moto, the cycling, the alpine skiing and the biathlon
  // (8/10/2026): the same events as golf's, one winner market each.
  const read = (name: string) => readSportncoTournaments(load(`netbet-winners-${name}`), NETBET);
  const titles = (name: string) => read(name).map((e) => e.participants[0]);

  it("reads a Grand Prix's race and sprint, told from the F2 and Nascar by their section", () => {
    const events = read("automobile");
    // Not the Top 3, 6 and 10 (other markets), nor "Pole Position" (the
    // qualifying's winner: its bet is not labelled "Vainqueur").
    expect(events.map((e) => [e.sport, e.participants[0]])).toEqual([
      ["formule 1", "Grand Prix de Singapour 2026 - Sprint"],
      ["formule 1", "Grand Prix de Singapour 2026"],
      ["automobile", "Bank of America Roval 400 2026"],
      ["automobile", "F2 - Championnat du Monde 2026"],
      ["formule 1", "Championnat du Monde 2026"],
    ]);
    const race = events[1];
    expect(race).toMatchObject({
      competition: "Championnat du Monde de Formule 1",
      startTime: "2026-10-11T12:00:00.000Z",
      sourceId: "11003142",
    });
    expect(race.odds).toHaveLength(22);
    expect(events[0].startTime).toBe("2026-10-10T09:00:00.000Z");
    expect(events.map((e) => e.odds.length)).toEqual([22, 22, 38, 4, 7]);
    expect(new Set(race.odds.map((o) => o.market))).toEqual(new Set(["Vainqueur"]));
  });

  it("reads the winners of the moto, the cycling, the alpine skiing and the biathlon under their shared keys", () => {
    expect(read("moto").map((e) => [e.sport, e.participants[0]])).toEqual([
      ["moto", "Grand Prix d’Indonésie 2026"],
      ["moto", "Championnat du Monde 2026"],
    ]);
    expect(read("cyclisme").map((e) => [e.sport, e.participants[0]])).toEqual([
      ["cyclisme", "Tour de France 2027"],
      ["cyclisme", "Tour de Lombardie 2026"],
    ]);
    expect(read("ski-alpin").map((e) => [e.sport, e.participants[0]])).toEqual([
      ["ski alpin", "Coupe du Monde (F) 2026/2027"],
      ["ski alpin", "Coupe du Monde 2026/2027"],
    ]);
    expect(titles("biathlon")).toEqual(["Coupe du Monde (F) 2026/2027", "Coupe du Monde 2026/2027"]);
    expect(read("biathlon").every((e) => e.sport === "biathlon")).toBe(true);
  });
});

describe("readSportncoEvents, badminton, table tennis and volleyball", () => {
  // Real answers to the "prematch_event_list" component of NetBet's pages
  // (8/10/2026), trimmed to their first matches; the doubles are listed with
  // the singles, their pairs named "Jiang-Wei".
  const read = (name: string) => readSportncoEvents(load(`netbet-matches-${name}`), NETBET);

  it("reads their matches as winners, under the shared sport keys", () => {
    const badminton = read("badminton");
    expect(badminton.map((e) => e.sport)).toEqual(Array(4).fill("badminton"));
    expect(badminton.find((e) => e.participants[0] === "Lee Zii Jia")).toMatchObject({
      competition: "Artic Open",
      participants: ["Lee Zii Jia", "Christo Popov"],
      odds: [
        { market: "Vainqueur du match", selection: "Lee Zii Jia", price: 3.45 },
        { market: "Vainqueur du match", selection: "Christo Popov", price: 1.14 },
      ],
    });
    expect(read("tennis-de-table").map((e) => e.sport)).toEqual(Array(4).fill("tennis de table"));
    const volleyball = read("volleyball");
    expect(volleyball.map((e) => e.sport)).toEqual(["volley-ball", "volley-ball"]);
    expect(volleyball[0].participants).toEqual(["Stal Mielec", "KS Palac Bydgoszcz"]);
  });
});

describe("readCompetitions", () => {
  it("lists a sport's competitions with matches, from its page's A-Z menu", () => {
    const competitions = readCompetitions(load("netbet-football-page"), "/football");
    expect(competitions).toHaveLength(57);
    expect(competitions).toContain("/football/allemagne/bundesliga");
    expect(competitions.every((url) => url.startsWith("/football/"))).toBe(true);
  });
});

describe("fetchSportnco", () => {
  afterEach(() => vi.unstubAllGlobals());

  type Asked = { url: string; urlKey: string; component: string };
  function fakeApi(answer: (asked: Asked) => unknown) {
    const asked: Asked[] = [];
    vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      const a = { url, urlKey: body.context.url_key, component: body.components[0].tree_compo_key };
      asked.push(a);
      const reply = answer(a);
      return reply instanceof Error
        ? { ok: false, status: 503, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => reply };
    });
    return asked;
  }

  it("lists each sport's competitions, then reads each one's matches", async () => {
    const asked = fakeApi(({ urlKey, component }) => {
      if (component === "menu_az_sportcatcomp")
        return urlKey === "/football" ? load("netbet-football-page") : { components: [] };
      return urlKey === "/football/ligue-des-nations/ligue-des-nations"
        ? load("netbet-ligue-des-nations")
        : { components: [] };
    });
    const events = await fetchSportnco(NETBET);
    expect(events).toHaveLength(10);
    expect(asked.every((a) => a.url.startsWith("https://ws.netbet.fr/component/data"))).toBe(true);
    expect(asked.filter((a) => a.component === "menu_az_sportcatcomp").map((a) => a.urlKey)).toContain("/hockey-glace");
    expect(asked.filter((a) => a.component === "prematch_event_list")).toHaveLength(57);
  });

  it("reads Genybet from its own API, with the same limits and the same sports as NetBet's", async () => {
    const asked = fakeApi(({ urlKey, component }) => {
      if (component === "menu_az_sportcatcomp")
        return urlKey === "/football" ? load("netbet-football-page") : { components: [] };
      return urlKey === "/football/ligue-des-nations/ligue-des-nations"
        ? load("netbet-ligue-des-nations")
        : { components: [] };
    });
    const events = await fetchSportnco(GENYBET);
    expect(events).toHaveLength(10);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((a) => a.url.startsWith("https://ws.genybet.fr/component/data"))).toBe(true);
    const fetched = await genybetScraper.fetch();
    expect(fetched).toHaveLength(10);
    expect(genybetScraper.id).toBe("genybet");
  });

  it("fails alone, naming Genybet, when every sport is rejected", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fakeApi(() => new Error("403"));
    await expect(fetchSportnco(GENYBET)).rejects.toThrow("every genybet sport failed");
    warn.mockRestore();
  });

  it("reads golf's tournaments from its page's winners, not from competitions' match lists", async () => {
    const asked = fakeApi(({ urlKey, component }) => {
      if (component === "final_winner") return urlKey === "/golf" ? load("netbet-golf-winners") : { components: [] };
      if (component === "menu_az_sportcatcomp")
        return urlKey === "/football" ? load("netbet-football-page") : { components: [] };
      return urlKey === "/football/ligue-des-nations/ligue-des-nations"
        ? load("netbet-ligue-des-nations")
        : { components: [] };
    });
    const events = await fetchSportnco(NETBET);
    expect(events.filter((e) => e.sport === "golf")).toHaveLength(5);
    expect(events).toHaveLength(15);
    // The pages whose events are tournaments and races, golf's and the others'.
    const tournamentPages = ["/golf", "/sport-automobile", "/moto", "/cyclisme", "/ski-alpin", "/biathlon"];
    // Then the pages of the sports with head-to-heads, for the winners of their competitions.
    const competitionPages = ["/football", "/tennis", "/basketball", "/hockey-glace", "/rugby", "/handball", "/foot-us", "/baseball", "/rugby-a-xiii", "/snooker"];
    expect(asked.filter((a) => a.component === "final_winner").map((a) => a.urlKey)).toEqual([...tournamentPages, ...competitionPages]);
    // Their competitions have no match list: asking for them would be wasted requests.
    expect(asked.some((a) => tournamentPages.some((page) => a.urlKey.startsWith(page)) && a.component !== "final_winner")).toBe(false);
    // /formule-1 is a section of /sport-automobile, not a page.
    expect(asked.some((a) => a.urlKey.startsWith("/formule-1"))).toBe(false);
  });

  it("reads the winners of the other sports' pages, and the new sports' matches", async () => {
    const asked = fakeApi(({ urlKey, component }) => {
      if (component === "final_winner") return urlKey === "/moto" ? load("netbet-winners-moto") : { components: [] };
      if (component === "menu_az_sportcatcomp")
        return ["/badminton", "/volleyball"].includes(urlKey)
          ? { components: [{ tree_compo_key: "menu_az_sportcatcomp", data: { menu: [{ url: `${urlKey}/x`, identifier: "competition", nb_events: 2 }] } }] }
          : { components: [] };
      return urlKey === "/badminton/x" ? load("netbet-matches-badminton") : { components: [] };
    });
    const events = await fetchSportnco(NETBET);
    expect(events.filter((e) => e.sport === "moto")).toHaveLength(2);
    expect(events.filter((e) => e.sport === "badminton")).toHaveLength(4);
    const sportPages = asked.filter((a) => a.component === "menu_az_sportcatcomp").map((a) => a.urlKey);
    expect(sportPages).toEqual(expect.arrayContaining(["/volleyball", "/badminton", "/tennis-de-table"]));
  });

  it("keeps the matches when golf's page fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fakeApi(({ urlKey, component }) => {
      if (component === "final_winner") return new Error();
      if (component === "menu_az_sportcatcomp")
        return urlKey === "/football" ? load("netbet-football-page") : { components: [] };
      return urlKey === "/football/ligue-des-nations/ligue-des-nations"
        ? load("netbet-ligue-des-nations")
        : { components: [] };
    });
    expect(await fetchSportnco(NETBET)).toHaveLength(10);
  });

  it("skips a competition that fails, but fails when every sport does", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fakeApi(({ urlKey, component }) => {
      if (component === "menu_az_sportcatcomp")
        return urlKey === "/football" ? load("netbet-football-page") : { components: [] };
      return urlKey === "/football/ligue-des-nations/ligue-des-nations"
        ? load("netbet-ligue-des-nations")
        : new Error();
    });
    expect(await fetchSportnco(NETBET)).toHaveLength(10);
    fakeApi(() => new Error());
    await expect(fetchSportnco(NETBET)).rejects.toThrow("every netbet sport failed");
  });
});

// Real answers of NetBet's "final_winner" component for the pages of the sports with
// head-to-heads (/lvs 14/10/2026), the runners of each bet cut to the first twelve:
// the main competitions' winners, and the other bets listed beside them.
const COMPETITIONS: Record<string, unknown> = JSON.parse(
  gunzipSync(readFileSync(join(__dirname, "fixtures/sportnco-netbet-competition-winners.json.gz"))).toString()
);

describe("readSportncoTournaments, the winners of competitions", () => {
  const read = (page: string) => readSportncoTournaments(COMPETITIONS[page], NETBET);
  const titles = (page: string) => read(page).map((e) => e.participants[0]);

  it("reads a league's winner as an outright of football, titled with the league and its season", () => {
    const ligue1 = read("/football").find((e) => e.participants[0] === "Ligue 1 McDonald's® 2026/2027")!;
    expect(ligue1).toMatchObject({ sport: "football", competition: "Ligue 1 McDonald's®", sourceId: "11538955" });
    expect(ligue1.odds).toHaveLength(12);
    expect(new Set(ligue1.odds.map((o) => o.market))).toEqual(new Set(["Vainqueur"]));
    expect(titles("/football")).toEqual(expect.arrayContaining(["Premier League 2026/2027", "LaLiga 2026/2027", "Bundesliga 2026/2027"]));
  });

  it("leaves out the other bets listed beside a winner: the Top 4, the top scorer, the relegated, the field without a favourite", () => {
    const found = titles("/football");
    expect(found.some((title) => /top|buteur|passeur|rel[eé]g|maintien|sans/i.test(title))).toBe(false);
    // One winner each: Ligue 1, Ligue 2, the Premier League, LaLiga, the Bundesliga...
    expect(new Set(found).size).toBe(found.length);
  });

  it("reads the Grand Slams as tennis, the men's and the women's apart", () => {
    expect(titles("/tennis")).toEqual(
      expect.arrayContaining(["ATP - Roland Garros 2027", "WTA - Roland-Garros 2027", "ATP - Wimbledon 2027", "WTA - Wimbledon 2027"])
    );
    expect(read("/tennis").every((e) => e.sport === "tennis")).toBe(true);
  });

  it("reads the NBA's, and leaves out a conference's or a group's winner in a cup", () => {
    const found = titles("/basketball");
    expect(found).toContain("NBA 2026/2027");
    expect(found.some((title) => /conf[eé]rence|groupe/i.test(title))).toBe(false);
  });

  it("leaves out a conference's winner, a league's of two, a regular season's and a top scorer", () => {
    expect(titles("/hockey-glace")).toEqual(["NHL 2026/2027"]);
    expect(titles("/foot-us")).toEqual(["NFL 2026/2027"]);
    expect(titles("/baseball")).toEqual(["MLB 2026"]);
    const rugby = titles("/rugby");
    expect(rugby).toContain("Top 14 2026/2027");
    expect(rugby.some((title) => /saison|marqueur/i.test(title))).toBe(false);
  });
});
