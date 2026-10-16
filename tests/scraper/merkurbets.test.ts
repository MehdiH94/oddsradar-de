import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchMerkurBets, MerkurGame, MerkurGamesReply, merkurOddsToDecimal, MERKURBETS_SPORTS, parseMerkurGames } from "../../src/scraper/merkurbets";
import { netOfStakeTax } from "../../src/scraper/stakeTax";

// Real answers of Merkur Bets's odds service (getGames/12, from a German IP,
// 15/10/2026): each sport's first 12 games before kick-off, with their main
// market only, as the scraper asks for them.
const reply = (name: string): MerkurGamesReply =>
  JSON.parse(readFileSync(join(__dirname, `fixtures/merkurbets-${name}.json`), "utf8"));
const FOOTBALL = reply("football");
const TENNIS = reply("tennis");
const ICE_HOCKEY = reply("ice-hockey");
const BASKETBALL = reply("basketball");

afterEach(() => vi.unstubAllGlobals());

const first = (r: MerkurGamesReply): MerkurGame => r.games![0];
const withGame = (game: MerkurGame): MerkurGamesReply => ({ games: [game] });

describe("netOfStakeTax", () => {
  it("takes the tax off what a price pays for the stake bet, to the thousandth", () => {
    expect(netOfStakeTax(2, 0.05)).toBe(1.9);
    expect(netOfStakeTax(2.15, 0.05)).toBe(2.043);
    expect(netOfStakeTax(NaN, 0.05)).toBeNaN();
  });
});

describe("merkurOddsToDecimal", () => {
  it("reads the hundredths the API gives, and no price as missing", () => {
    expect(merkurOddsToDecimal(316)).toBe(3.16);
    expect(merkurOddsToDecimal(0)).toBeNaN();
    expect(merkurOddsToDecimal(null)).toBeNaN();
  });
});

describe("parseMerkurGames", () => {
  it("reads a football match's result in regular time, labelled with the teams, net of the 5% tax", () => {
    const events = parseMerkurGames(FOOTBALL, "1");
    expect(events).toHaveLength(12);
    expect(events[0]).toEqual({
      sport: "football",
      competition: "Argentina Primera LPF Clausura",
      startTime: "2026-10-15T23:00:00.000Z",
      participants: ["CA Huracan", "Gimnasia LaPlata"],
      // 2.15, 3.00 and 3.32 as the site shows them.
      odds: [
        { market: "1X2", selection: "CA Huracan", price: 2.043 },
        { market: "1X2", selection: "Draw", price: 2.85 },
        { market: "1X2", selection: "Gimnasia LaPlata", price: 3.154 },
      ],
      sourceId: "3197685282",
    });
  });

  it("reads a tennis match's winner, the competition without the sport's name that leads it", () => {
    const [event] = parseMerkurGames(TENNIS, "2");
    expect(event.sport).toBe("tennis");
    expect(event.competition).toBe("WTA Wuhan");
    expect(event.participants).toEqual(["Shnaider, Diana", "Ostapenko, Jelena"]);
    expect(event.odds).toEqual([
      { market: "Vainqueur du match", selection: "Shnaider, Diana", price: 1.33 },
      { market: "Vainqueur du match", selection: "Ostapenko, Jelena", price: 2.593 },
    ]);
  });

  it("reads ice hockey's 1X2 in regular time, and basketball's winner from either of its main markets", () => {
    const [hockey] = parseMerkurGames(ICE_HOCKEY, "10");
    expect(hockey.sport).toBe("hockey sur glace");
    expect(hockey.competition).toBe("USA NHL");
    expect(hockey.odds.map((o) => o.selection)).toEqual(["Toronto Maple Leafs", "Draw", "Buffalo Sabres"]);
    expect(hockey.odds[1].price).toBe(3.99);

    const basketball = parseMerkurGames(BASKETBALL, "12");
    expect(basketball).toHaveLength(12);
    expect(new Set(BASKETBALL.games!.map((g) => g.markets![0].id))).toEqual(new Set([21702, 21672]));
    expect(basketball[0].sport).toBe("basketball");
    expect(basketball[0].odds).toEqual([
      { market: "Vainqueur du match", selection: "La Union", price: 1.473 },
      { market: "Vainqueur du match", selection: "Racing de Chivilcoy", price: 2.176 },
    ]);
  });

  it("leaves out a live game, a game without its main market, and one whose market has another number of outcomes", () => {
    const game = first(FOOTBALL);
    expect(parseMerkurGames(withGame({ ...game, type: 1 }), "1")).toEqual([]);
    expect(parseMerkurGames(withGame({ ...game, markets: [] }), "1")).toEqual([]);
    expect(parseMerkurGames(withGame({ ...game, markets: [{ ...game.markets![0], isPrimary: false }] }), "1")).toEqual([]);
    expect(parseMerkurGames(withGame({ ...game, markets: [{ ...game.markets![0], tips: game.markets![0].tips!.slice(0, 2) }] }), "1")).toEqual([]);
    expect(parseMerkurGames(withGame({ ...game, teams: game.teams!.slice(0, 1) }), "1")).toEqual([]);
  });

  it("reads a rugby league game as rugby league, by its competition's name", () => {
    const game = { ...first(FOOTBALL), sport: 18, markets: [{ ...first(FOOTBALL).markets![0], id: 27232 }] };
    const union = parseMerkurGames(withGame({ ...game, leagueInfo: { name: "Rugby - Rugby Union European Champions Cup Pool 1" } }), "18");
    const league = parseMerkurGames(withGame({ ...game, leagueInfo: { name: "Rugby - Rugby League Super League" } }), "18");
    expect(union[0].sport).toBe("rugby à xv");
    expect(league[0].sport).toBe("rugby à xiii");
  });

  it("drops a game whose outcomes it cannot name, and keeps the others", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = { ...first(FOOTBALL), markets: [{ ...first(FOOTBALL).markets![0], tips: [{ text: "1", odds: 200 }, { text: "?", odds: 300 }, { text: "2", odds: 400 }] }] };
    const events = parseMerkurGames({ games: [broken, ...FOOTBALL.games!.slice(1)] }, "1");
    expect(events).toHaveLength(11);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("fetchMerkurBets", () => {
  it("asks each sport's games before kick-off with its main market only, in the site's German context", async () => {
    const answers: Record<number, MerkurGamesReply> = { 1: FOOTBALL, 2: TENNIS, 10: ICE_HOCKEY, 12: BASKETBALL };
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      return new Response(JSON.stringify(answers[body.sportIds[0]] ?? { games: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => {
      fn();
      return 0;
    }) as unknown as typeof setTimeout);

    const events = await fetchMerkurBets();
    expect(events).toHaveLength(48);
    expect(fetchMock).toHaveBeenCalledTimes(Object.keys(MERKURBETS_SPORTS).length);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://oddsservice-msw-mb-de.cashpoint.solutions/odds/getGames/12");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ gameTypes: [4], jurisdictionId: 386, sportIds: [1], marketIds: [22242], limit: 500, offset: 0 });
    expect((init.headers as Record<string, string>)["x-location"]).toBe("82");
    vi.restoreAllMocks();
  });

  it("pages through a sport longer than a page", async () => {
    const page = (n: number): MerkurGamesReply => ({ games: Array.from({ length: n }, () => first(FOOTBALL)) });
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const games = body.sportIds[0] !== 1 ? page(0) : body.offset === 0 ? page(500) : page(3);
      return new Response(JSON.stringify(games), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => {
      fn();
      return 0;
    }) as unknown as typeof setTimeout);

    expect(await fetchMerkurBets()).toHaveLength(503);
    const football = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init.body))).filter((b) => b.sportIds[0] === 1);
    expect(football.map((b) => b.offset)).toEqual([0, 500]);
    vi.restoreAllMocks();
  });

  it("fails when every sport fails, so that the cycle retries it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => {
      fn();
      return 0;
    }) as unknown as typeof setTimeout);
    await expect(fetchMerkurBets()).rejects.toThrow("every merkurbets sport failed");
    vi.restoreAllMocks();
  });
});
