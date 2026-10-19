import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  boostedPrice,
  fetchTwentybet,
  parseTwentybetEvents,
  retryAfterMs,
  teamName,
  TwentybetBoost,
  TWENTYBET_SPORTS,
  twentybetListUrl,
  TwentybetListReply,
} from "../../src/scraper/twentybet";

// Real answers of 20bet's event list (platform.20bet.com/api/event/list, from
// a German IP, 15/10/2026): each sport's first 6 events, their markets trimmed
// to the main one and two others, their competitors' players to two.
const reply = (name: string): TwentybetListReply => JSON.parse(readFileSync(join(__dirname, `fixtures/20bet-${name}.json`), "utf8"));
const FOOTBALL = reply("football");
const TENNIS = reply("tennis");
const BASKETBALL = reply("basketball");
const ICE_HOCKEY = reply("ice-hockey");
// Its darts (sport 18), from the same list (18/10/2026): the first 6, their
// winner only.
const DARTS = reply("darts");
// Its odds boosts of the moment (platform.20bet.com/api/v4/boosted-odds,
// 18/10/2026): six, two of them on a 1X2.
const BOOSTS: TwentybetBoost[] = JSON.parse(readFileSync(join(__dirname, "fixtures/20bet-boosts.json"), "utf8")).data;
const isBoostsUrl = (url: string) => url.includes("/boosted-odds");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// A copy of an answer, changed by `edit`.
const changed = (r: TwentybetListReply, edit: (copy: TwentybetListReply) => void): TwentybetListReply => {
  const copy = structuredClone(r);
  edit(copy);
  return copy;
};
const noDelay = () =>
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => {
    fn();
    return 0;
  }) as unknown as typeof setTimeout);

describe("parseTwentybetEvents", () => {
  it("reads a football match's result in regular time, labelled with the teams, its kick-off in UTC", () => {
    const events = parseTwentybetEvents(FOOTBALL, "1");
    expect(events).toHaveLength(6);
    expect(events[0]).toEqual({
      sport: "football",
      competition: "UEFA Champions League",
      startTime: "2026-10-20T16:45:00.000Z",
      participants: ["Fenerbahce Istanbul", "Slavia Prague"],
      // As the site shows them: 20bet takes no German tax.
      odds: [
        { market: "1X2", selection: "Fenerbahce Istanbul", price: 1.62 },
        { market: "1X2", selection: "Draw", price: 4 },
        { market: "1X2", selection: "Slavia Prague", price: 4.8 },
      ],
      sourceId: "11336339",
    });
  });

  it("reads a tennis match's winner and a basketball game's, overtime included", () => {
    const [tennis] = parseTwentybetEvents(TENNIS, "3");
    expect(tennis.sport).toBe("tennis");
    expect(tennis.participants).toEqual(["Jodar, Rafael", "Ruud, Casper"]);
    expect(tennis.odds).toEqual([
      { market: "Vainqueur du match", selection: "Jodar, Rafael", price: 1.76 },
      { market: "Vainqueur du match", selection: "Ruud, Casper", price: 2.08 },
    ]);
    const [basketball] = parseTwentybetEvents(BASKETBALL, "2");
    expect(basketball.sport).toBe("basketball");
    expect(basketball.competition).toBe("Euroleague");
    expect(basketball.odds.map((o) => o.price)).toEqual([1.32, 3.3]);
  });

  it("reads a darts match's winner, as darts", () => {
    const [first] = parseTwentybetEvents(DARTS, "18");
    expect(parseTwentybetEvents(DARTS, "18")).toHaveLength(6);
    expect(first).toEqual({
      sport: "fléchettes",
      competition: "Modus Super Series. 2026",
      startTime: "2026-10-19T08:40:00.000Z",
      participants: ["Grant Sampson", "Archie Self"],
      odds: [
        { market: "Vainqueur du match", selection: "Grant Sampson", price: 5 },
        { market: "Vainqueur du match", selection: "Archie Self", price: 1.1 },
      ],
      sourceId: expect.any(String),
    });
  });

  it("leaves out the games already started, which the list may still give", () => {
    expect(ICE_HOCKEY.data!.items!.filter((e) => e.status !== 0)).toHaveLength(5);
    const events = parseTwentybetEvents(ICE_HOCKEY, "4");
    expect(events).toHaveLength(1);
    expect(events[0].sport).toBe("hockey sur glace");
    expect(events[0].odds.map((o) => o.selection)).toContain("Draw");
  });

  it("leaves out an event whose main market is closed or missing, and an outcome closed", () => {
    const id = String(FOOTBALL.data!.items![0].id);
    const closed = changed(FOOTBALL, (c) => {
      c.data!.relations!.odds![id].find((m) => m.vendorMarketId === 1)!.status = 0;
    });
    expect(parseTwentybetEvents(closed, "1").map((e) => e.sourceId)).not.toContain(id);
    const missing = changed(FOOTBALL, (c) => {
      c.data!.relations!.odds![id] = c.data!.relations!.odds![id].filter((m) => m.vendorMarketId !== 1);
    });
    expect(parseTwentybetEvents(missing, "1").map((e) => e.sourceId)).not.toContain(id);
    const oneClosed = changed(FOOTBALL, (c) => {
      c.data!.relations!.odds![id].find((m) => m.vendorMarketId === 1)!.outcomes![1].active = 0;
    });
    // The outcome closed has no price to keep (validateRawEvent drops it).
    const kept = parseTwentybetEvents(oneClosed, "1").find((e) => e.sourceId === id)!;
    expect(kept.odds.map((o) => o.selection)).toEqual(["Fenerbahce Istanbul", "Slavia Prague"]);
  });

  it("reads a rugby league game as rugby league, by its league's name", () => {
    const rugby = (league: string) =>
      changed(FOOTBALL, (c) => {
        c.data!.items = c.data!.items!.slice(0, 1).map((e) => ({ ...e, sportId: 13 }));
        c.data!.relations!.league = [{ id: c.data!.items[0].leagueId!, name: league }];
      });
    expect(parseTwentybetEvents(rugby("European Champions Cup"), "13")[0].sport).toBe("rugby à xv");
    expect(parseTwentybetEvents(rugby("Rugby League World Cup. 2026"), "13")[0].sport).toBe("rugby à xiii");
  });

  it("marks a youth or a women's team by its league, which 20bet leaves out of the name", () => {
    expect(teamName("Bern", "Switzerland Championship U21")).toBe("Bern U21");
    expect(teamName("Lausanne Academy", "Switzerland Championship U21")).toBe("Lausanne Academy U21");
    expect(teamName("Poland U21", "UEFA European Championship U21. Qualification")).toBe("Poland U21");
    expect(teamName("Arsenal", "England. Women's Super League")).toBe("Arsenal (W)");
    expect(teamName("Arsenal (W)", "England. Women's Super League")).toBe("Arsenal (W)");
    expect(teamName("SC Bern", "Switzerland National League")).toBe("SC Bern");

    const youth = changed(ICE_HOCKEY, (c) => {
      c.data!.relations!.league = c.data!.relations!.league!.map((l) => ({ ...l, name: "Switzerland Championship U21" }));
    });
    expect(parseTwentybetEvents(youth, "4")[0].participants.every((p) => p.endsWith(" U21"))).toBe(true);
  });

  it("drops an event whose outcomes it cannot name, and keeps the others", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const id = String(FOOTBALL.data!.items![0].id);
    const broken = changed(FOOTBALL, (c) => {
      c.data!.relations!.odds![id].find((m) => m.vendorMarketId === 1)!.outcomes![0].vendorOutcomeId = "9";
    });
    expect(parseTwentybetEvents(broken, "1")).toHaveLength(5);
    expect(warn).toHaveBeenCalled();
  });
});

// 20bet names a boost's outcome and how much more it pays, its page works out
// the price (its module 86362, ported in boostedPrice and checked against it
// on 50 000 random markets, 18/10/2026).
describe("20bet's odds boosts", () => {
  it("prices a 1X2's boosted outcome as 20bet's page does, its market brought to 101%", () => {
    const parma = BOOSTS.find((b) => b.eventId === 11643767 && b.marketId === 621)!;
    const cagliari = BOOSTS.find((b) => b.eventId === 11643762 && b.marketId === 621)!;
    // Parma - Torino's 3.25 / 3.10 / 2.40 (105%), Parma boosted; Monza -
    // Cagliari's 2.44 / 3.20 / 3.05, Cagliari boosted (18/10/2026).
    expect(boostedPrice(parma, [3.25, 3.1, 2.4], 0)).toBe(3.38);
    expect(boostedPrice(cagliari, [2.44, 3.2, 3.05], 2)).toBe(3.18);
    // A market of two: Tottenham - Coventry's over 3.5 goals.
    expect(boostedPrice({ boostMethod: 1, marginBoost: 101 }, [2.42, 1.57], 0)).toBe(2.55);
  });

  it("prices a boost by a factor, and none that would not pay more", () => {
    expect(boostedPrice({ boostMethod: 2, factorBoost: 1.1 }, [2, 3.4, 4], 0)).toBe(2.2);
    expect(boostedPrice({ boostMethod: 2, factorBoost: 0.9 }, [2, 3.4, 4], 0)).toBeUndefined();
    // A market already paying more than the boost's 101%.
    expect(boostedPrice({ boostMethod: 1, marginBoost: 101 }, [2.1, 2.1], 0)).toBeUndefined();
    expect(boostedPrice({ boostMethod: 1, marginBoost: 101 }, [2, Number.NaN, 4], 0)).toBeUndefined();
  });

  it("puts the boosted price beside the price, on its outcome only", () => {
    // Fenerbahce - Slavia's result (20bet's market 621), Fenerbahce boosted.
    const events = parseTwentybetEvents(FOOTBALL, "1", [
      { eventId: 11336339, marketId: 621, outcomeId: 1, specifiers: null, boostMethod: 1, marginBoost: 101 },
      // A line's boost is not the main market's.
      { eventId: 11336328, marketId: 621, outcomeId: 3, specifiers: "total=2.5", boostMethod: 1, marginBoost: 101 },
    ]);
    expect(events[0].odds).toEqual([
      { market: "1X2", selection: "Fenerbahce Istanbul", price: 1.62, boosted: 1.69 },
      { market: "1X2", selection: "Draw", price: 4 },
      { market: "1X2", selection: "Slavia Prague", price: 4.8 },
    ]);
    expect(events.flatMap((e) => e.odds).filter((o) => o.boosted !== undefined)).toHaveLength(1);
  });
});

describe("fetchTwentybet", () => {
  it("asks each sport's events before kick-off, page after page", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        if (isBoostsUrl(url)) return new Response(JSON.stringify({ data: BOOSTS }), { status: 200 });
        const params = new URL(url).searchParams;
        const page = Number(params.get("page"));
        const answer: TwentybetListReply =
          params.get("sportId_eq") === "1" ? { data: { ...FOOTBALL.data, page, lastPage: 2 } } : { data: { page: 1, lastPage: 1, items: [] } };
        return new Response(JSON.stringify(answer), { status: 200 });
      })
    );
    noDelay();
    // Football's two pages, the same answer twice.
    expect(await fetchTwentybet()).toHaveLength(12);
    // The boosts first, then each sport.
    expect(urls).toHaveLength(Object.keys(TWENTYBET_SPORTS).length + 2);
    expect(urls[0]).toBe("https://platform.20bet.com/api/v4/boosted-odds?lang=en&clientType=0&countryCode=DE");
    expect(urls[1]).toBe(twentybetListUrl("1", 1));
    expect(urls[2]).toBe(twentybetListUrl("1", 2));
    expect(urls[1]).toContain("https://platform.20bet.com/api/event/list?lang=en&main=1&status_in[]=0&oddsExists_eq=1&sportId_eq=1");
  });

  it("waits as long as a 429 asks, then asks again once", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (isBoostsUrl(url)) return new Response(JSON.stringify({ data: [] }), { status: 200 });
        calls++;
        if (calls === 1) return new Response("", { status: 429, headers: { "retry-after": "2" } });
        const sport = new URL(url).searchParams.get("sportId_eq");
        const answer = sport === "1" ? { data: { ...FOOTBALL.data, page: 1, lastPage: 1 } } : { data: { page: 1, lastPage: 1, items: [] } };
        return new Response(JSON.stringify(answer), { status: 200 });
      })
    );
    const waits: number[] = [];
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms: number) => {
      waits.push(ms);
      fn();
      return 0;
    }) as unknown as typeof setTimeout);
    expect(await fetchTwentybet()).toHaveLength(6);
    expect(waits[0]).toBe(2000);
    expect(retryAfterMs(null)).toBe(10_000);
    expect(retryAfterMs("600")).toBe(30_000);
  });

  it("reads the prices without the boosts when the boosts fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (isBoostsUrl(url)) return new Response("", { status: 503 });
        const sport = new URL(url).searchParams.get("sportId_eq");
        const answer = sport === "1" ? { data: { ...FOOTBALL.data, page: 1, lastPage: 1 } } : { data: { page: 1, lastPage: 1, items: [] } };
        return new Response(JSON.stringify(answer), { status: 200 });
      })
    );
    noDelay();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await fetchTwentybet()).toHaveLength(6);
  });

  it("fails when every sport fails, so that the cycle retries it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    noDelay();
    await expect(fetchTwentybet()).rejects.toThrow("every twentybet sport failed");
  });
});
