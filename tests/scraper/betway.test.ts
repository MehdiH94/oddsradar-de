import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BETWAY_CONTEXT, BetwayEventsReply, betwayScraper, parseBetwayEvents } from "../../src/scraper/betway";

// Real captures of the API Betway.de's sports pages read, from a German IP
// (15/10/2026): getEvents' answer for 8 upcoming events of each sport, asked
// with that sport's main market (football's and ice hockey's 1X2, tennis's
// winner, basketball's "triplet": the winner, the handicap and the total).
const capture = (category: string): BetwayEventsReply =>
  JSON.parse(readFileSync(join(__dirname, `fixtures/betway-${category}.json`), "utf8")).events;
const SOCCER = capture("soccer");
const TENNIS = capture("tennis");
const BASKETBALL = capture("basketball");
const HOCKEY = capture("ice-hockey");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("parseBetwayEvents", () => {
  it("reads a football match as a 1X2 labelled with the teams and Draw", () => {
    const events = parseBetwayEvents(SOCCER, "soccer");
    expect(events).toHaveLength(8);
    expect(events[0]).toEqual({
      sport: "football",
      competition: "Primera B",
      startTime: "2026-10-15T21:00:00.000Z",
      participants: ["B.F.C.", "Tigres FC"],
      odds: [
        { market: "1X2", selection: "B.F.C.", price: 2.4 },
        { market: "1X2", selection: "Draw", price: 3 },
        { market: "1X2", selection: "Tigres FC", price: 2.875 },
      ],
      sourceId: "17345363",
    });
  });

  it("reads a tennis match's winner", () => {
    const [shnaider] = parseBetwayEvents(TENNIS, "tennis");
    expect(shnaider).toMatchObject({
      sport: "tennis",
      competition: "Wuhan",
      participants: ["Diana Shnaider", "Jelena Ostapenko"],
      odds: [
        { market: "Vainqueur du match", selection: "Diana Shnaider", price: 1.38 },
        { market: "Vainqueur du match", selection: "Jelena Ostapenko", price: 3 },
      ],
    });
  });

  it("reads a basketball match's winner out of its three markets, the outcomes named the other way", () => {
    const events = parseBetwayEvents(BASKETBALL, "basketball");
    expect(events).toHaveLength(8);
    expect(events[0]).toMatchObject({
      sport: "basketball",
      participants: ["Puerto Montt", "Mun. Puente Alto"],
      odds: [
        { market: "Vainqueur du match", selection: "Puerto Montt", price: 1.7 },
        { market: "Vainqueur du match", selection: "Mun. Puente Alto", price: 2.05 },
      ],
    });
  });

  it("reads an ice hockey match's result in regular time, with its draw", () => {
    const [florida] = parseBetwayEvents(HOCKEY, "ice-hockey");
    expect(florida).toMatchObject({
      sport: "hockey sur glace",
      competition: "NHL",
      participants: ["Florida Panthers", "Vancouver Canucks"],
      odds: [
        { market: "1X2", selection: "Florida Panthers", price: 1.556 },
        { market: "1X2", selection: "Draw", price: 4.5 },
        { market: "1X2", selection: "Vancouver Canucks", price: 4.75 },
      ],
    });
  });

  it("leaves out a live or an outright event, a suspended market, and a market of another shape", () => {
    const first = SOCCER.Events![0];
    const market = SOCCER.Markets!.find((m) => m.EventId === first.Id)!;
    const only = (reply: BetwayEventsReply) => parseBetwayEvents(reply, "soccer").map((e) => e.sourceId);
    expect(only({ ...SOCCER, Events: [{ ...first, IsLive: true }] })).toEqual([]);
    expect(only({ ...SOCCER, Events: [{ ...first, IsOutright: true }] })).toEqual([]);
    expect(only({ ...SOCCER, Events: [first], Markets: [{ ...market, IsSuspended: true }] })).toEqual([]);
    // A 1X2 asked for, two outcomes received: not the market it is read as.
    const twoOutcomes = SOCCER.Outcomes!.filter((o) => o.MarketId === market.Id).slice(0, 2);
    expect(only({ Events: [first], Markets: [market], Outcomes: twoOutcomes })).toEqual([]);
  });

  it("leaves out the price of an outcome the site no longer offers", () => {
    const outcomes = SOCCER.Outcomes!.map((o, i) => (i === 1 ? { ...o, IsActive: false } : o));
    const [event] = parseBetwayEvents({ ...SOCCER, Outcomes: outcomes }, "soccer");
    expect(event.odds.map((o) => o.selection)).toEqual(["B.F.C.", "Tigres FC"]);
  });

  it("reads nothing of a sport it is not read for, and survives an empty answer", () => {
    expect(parseBetwayEvents(SOCCER, "darts")).toEqual([]);
    expect(parseBetwayEvents({ Events: null, Markets: null, Outcomes: null }, "soccer")).toEqual([]);
  });
});

describe("betwayScraper.fetch", () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const REPLIES: Record<string, BetwayEventsReply> = { soccer: SOCCER, tennis: TENNIS, basketball: BASKETBALL, "ice-hockey": HOCKEY };

  // The API as it answers: a sport's event ids by competition, then the events.
  function api(overrides: (method: string, body: Record<string, unknown>) => Response | undefined = () => undefined) {
    return vi.fn(async (url: string, init: RequestInit) => {
      const method = url.split("/").pop()!;
      const body = JSON.parse(String(init.body));
      const overridden = overrides(method, body);
      if (overridden) return overridden;
      const reply = REPLIES[body.CategoryCName as string];
      if (method === "getEventsByCategory") return json({ Groups: [{ GroupCName: "all", Events: reply.Events!.map((e) => e.Id) }] });
      if (method === "getEvents") return json(reply);
      return json({}, 404);
    });
  }

  async function run(fetchMock: ReturnType<typeof api>) {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);
    const promise = betwayScraper.fetch();
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    return promise;
  }

  it("is Betway's scraper", () => {
    expect(betwayScraper.id).toBe("betway");
  });

  it("asks each sport's event ids, then their main market, with the site's German context", async () => {
    const fetchMock = api();
    const events = await run(fetchMock);

    expect(new Set(events.map((e) => e.sport))).toEqual(new Set(["football", "tennis", "basketball", "hockey sur glace"]));
    expect(events).toHaveLength(32);
    const bodies = fetchMock.mock.calls.map(([url, init]) => ({ method: String(url).split("/").pop(), body: JSON.parse(String(init.body)) }));
    for (const { body } of bodies) expect(body).toMatchObject(BETWAY_CONTEXT);
    expect(bodies.find((b) => b.method === "getEvents" && b.body.CategoryCName === "ice-hockey")?.body).toMatchObject({
      MarketCName: "win-draw-win",
      ExternalIds: HOCKEY.Events!.map((e) => e.Id),
    });
  });

  it("keeps the other sports when one fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const events = await run(api((method, body) => (body.CategoryCName === "tennis" ? json({}, 500) : undefined)));
    const sports = new Set(events.map((e) => e.sport));
    expect(sports.has("tennis")).toBe(false);
    expect(sports.has("football")).toBe(true);
  });

  it("throws when every sport fails, so the cycle retries the bookmaker", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(run(api(() => json({}, 403)))).rejects.toThrow(/every betway sport failed/);
  });
});
