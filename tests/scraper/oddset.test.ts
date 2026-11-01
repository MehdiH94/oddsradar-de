import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchOddset, ODDSET_SPORTS, OddsetReply, oddsetUrl, parseOddsetFixtures } from "../../src/scraper/oddset";
import { optionTeam } from "../../src/scraper/entain";

// Real answers of ODDSET's API (www.oddset.de/cds-api/bettingoffer/fixtures,
// in English, 19/10/2026): each sport's first 6 matches before kick-off and a
// live one, their teams, their main market and one other.
const reply = (name: string): OddsetReply => JSON.parse(readFileSync(join(__dirname, `fixtures/oddset-${name}.json`), "utf8"));
const FOOTBALL = reply("football");
const TENNIS = reply("tennis");
const BASKETBALL = reply("basketball");
const ICE_HOCKEY = reply("ice-hockey");
const HANDBALL = reply("handball");
// A US college game (01/11/2026), its options named "Memphis" and "Iowa St".
const NCAA = reply("ncaa");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// A copy of an answer, changed by `edit`.
const changed = (r: OddsetReply, edit: (copy: OddsetReply) => void): OddsetReply => {
  const copy = structuredClone(r);
  edit(copy);
  return copy;
};
const priceOf = (event: { odds: { selection: string; price: number }[] }, selection: string) =>
  event.odds.find((o) => o.selection === selection)?.price;

describe("parseOddsetFixtures", () => {
  it("reads a football match's result in ordinary time, its prices net of the 5.3% tax, and leaves the live match out", () => {
    const events = parseOddsetFixtures(FOOTBALL, "4");
    expect(events).toHaveLength(6);
    const [first] = events;
    expect(first).toMatchObject({
      sport: "football",
      competition: "Pro League",
      participants: ["Fajr Sepasi FC", "Paykan FC"],
      startTime: "2026-10-19T13:15:00.000Z",
      sourceId: "2:7895752",
    });
    // The site's 2.30 / 2.70 / 2.50, net of the tax.
    expect([priceOf(first, "Fajr Sepasi FC"), priceOf(first, "Draw"), priceOf(first, "Paykan FC")]).toEqual([2.178, 2.557, 2.367]);
    expect(first.odds.every((o) => o.market === "1X2")).toBe(true);
    // "Bandari FC (KEN)": the country left out.
    expect(events[1].participants[0]).toBe("Bandari FC");
  });

  it("reads a tennis match's winner, its players without their country", () => {
    const [first] = parseOddsetFixtures(TENNIS, "5");
    expect(first.participants).toEqual(["Andrea Guerrieri", "Alex Michelsen"]);
    expect(first.odds.map((o) => [o.market, o.selection, o.price])).toEqual([
      ["Vainqueur du match", "Andrea Guerrieri", 4.025],
      ["Vainqueur du match", "Alex Michelsen", 1.146],
    ]);
  });

  it("puts the home team first in an American match, named \"Away at Home\", its prices by the teams' nicknames", () => {
    const events = parseOddsetFixtures(BASKETBALL, "7");
    const nba = events.find((e) => e.competition === "NBA")!;
    // "Boston Celtics at Detroit Pistons": "Celtics" 1.87, "Pistons" 1.95.
    expect(nba.participants).toEqual(["Detroit Pistons", "Boston Celtics"]);
    expect([priceOf(nba, "Detroit Pistons"), priceOf(nba, "Boston Celtics")]).toEqual([1.847, 1.771]);
    const nhl = parseOddsetFixtures(ICE_HOCKEY, "12").find((e) => e.competition === "NHL")!;
    expect(nhl.participants).toEqual(["New York Rangers", "Anaheim Ducks"]);
    expect(nhl.odds.map((o) => o.selection).sort()).toEqual(["Anaheim Ducks", "Draw", "New York Rangers"]);
  });

  it("reads a US college game whose option shortens a team's name (\"Iowa St\" for Iowa State)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [game] = parseOddsetFixtures(NCAA, "7");
    expect(warn).not.toHaveBeenCalled();
    // "Memphis at Iowa State": Memphis 7.75, Iowa St 1.09.
    expect(game.participants).toEqual(["Iowa State", "Memphis"]);
    expect(game.odds.map((o) => o.selection).sort()).toEqual(["Iowa State", "Memphis"]);
    expect(priceOf(game, "Iowa State")).toBeLessThan(priceOf(game, "Memphis")!);
  });

  it("gives an option to the team it names the closest: \"Florida\" to Florida, not South Florida", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const florida = changed(NCAA, (r) => {
      const f = r.fixtures![0];
      f.name = { value: "South Florida at Florida" };
      f.participants![0].name = { value: "South Florida" };
      f.participants![1].name = { value: "Florida" };
      const [a, b] = f.optionMarkets![0].options!;
      a.name = { value: "South Florida" };
      b.name = { value: "Florida" };
    });
    const [game] = parseOddsetFixtures(florida, "7");
    expect(warn).not.toHaveBeenCalled();
    expect(game.participants).toEqual(["Florida", "South Florida"]);
    expect(priceOf(game, "Florida")).toBeLessThan(priceOf(game, "South Florida")!);
  });

  it("reads an ice hockey game's result after regular time, and a handball match's result", () => {
    for (const [r, sport, market] of [
      [ICE_HOCKEY, "12", "1X2"],
      [HANDBALL, "16", "1X2"],
    ] as const) {
      const events = parseOddsetFixtures(r, sport);
      expect(events).toHaveLength(6);
      for (const e of events) {
        expect(e.odds.map((o) => o.market)).toEqual([market, market, market]);
        expect(e.odds.some((o) => o.selection === "Draw")).toBe(true);
      }
    }
  });

  it("marks a women's team \"(W)\" as the other bookmakers do", () => {
    const women = changed(FOOTBALL, (copy) => {
      for (const p of copy.fixtures![0].participants!) p.name!.value += " (Women)";
    });
    expect(parseOddsetFixtures(women, "4")[0].participants).toEqual(["Fajr Sepasi FC (W)", "Paykan FC (W)"]);
  });

  it("leaves out a match whose market is suspended, and a sport it does not read", () => {
    const suspended = changed(FOOTBALL, (copy) => {
      copy.fixtures![0].optionMarkets![0].status = "Suspended";
    });
    expect(parseOddsetFixtures(suspended, "4")).toHaveLength(5);
    expect(parseOddsetFixtures(FOOTBALL, "999")).toEqual([]);
  });
});

describe("fetchOddset", () => {
  const empty: OddsetReply = { fixtures: [], totalCount: 0 };

  it("asks each sport's matches in German market with the site's headers, its main markets alone where they carry it", async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      urls.push(url);
      expect((init?.headers as Record<string, string>)["x-bwin-browser-url"]).toBe("https://www.oddset.de/de/sports");
      return new Response(JSON.stringify(url.includes("sportIds=4&") ? FOOTBALL : empty));
    });
    vi.stubGlobal("fetch", fetchMock);

    const events = await fetchOddset({ delayMs: 0 });

    expect(events).toHaveLength(6);
    expect(urls).toHaveLength(Object.keys(ODDSET_SPORTS).length);
    const football = new URL(urls[0]).searchParams;
    expect(football.get("country")).toBe("DE");
    expect(football.get("offerMapping")).toBe("MainMarkets");
    expect(new URL(oddsetUrl("16", 0)).searchParams.get("offerMapping")).toBe("Filtered");
  });

  it("reads a sport's next page while the answer is full", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        const skip = Number(new URL(url).searchParams.get("skip"));
        if (!url.includes("sportIds=4&")) return new Response(JSON.stringify(empty));
        // A first page of 500 fixtures (the same one again), of 1006 in all.
        const fixtures = skip === 0 ? Array.from({ length: 500 }, () => FOOTBALL.fixtures![6]) : FOOTBALL.fixtures;
        return new Response(JSON.stringify({ fixtures, totalCount: 1006 }));
      })
    );

    expect(await fetchOddset({ delayMs: 0 })).toHaveLength(6);
    expect(urls.filter((u) => u.includes("sportIds=4&")).map((u) => new URL(u).searchParams.get("skip"))).toEqual(["0", "500"]);
  });

  it("fails when every sport fails, so that the cycle retries it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 403 })));
    await expect(fetchOddset({ delayMs: 0 })).rejects.toThrow("every oddset sport failed");
  });
});

describe("optionTeam", () => {
  it("names the team by its name, its nickname or its shortened name, the closest first", () => {
    expect(optionTeam("Florida", "South Florida", "Florida")).toBe(2);
    expect(optionTeam("Iowa St", "Memphis", "Iowa State")).toBe(2);
    expect(optionTeam("Ducks", "Anaheim Ducks", "New York Rangers")).toBe(1);
    expect(optionTeam("St. Mary's", "St Mary's", "Gonzaga")).toBe(1);
  });

  it("names none when neither team or both as closely", () => {
    expect(optionTeam("Draw", "Memphis", "Iowa State")).toBeUndefined();
    expect(optionTeam("Florida", "North Florida", "South Florida")).toBeUndefined();
  });
});
