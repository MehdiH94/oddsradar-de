import { describe, it, expect, beforeEach, vi } from "vitest";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../../src/db/client";
import { getLatestEvents, getValueBets, saveMarketOdds, upsertCanonicalEvents } from "../../src/db/repository";
import { getEventDetail } from "../../src/db/eventDetail";
import { loadReferences, saveReferenceMarkets } from "../../src/db/reference";
import { MarketPrices, parsePriceFrames } from "../../src/reference/exchange";
import { REFERENCE_SPORTS } from "../../src/reference/sports";
import { runSportsReferenceCycle } from "../../src/reference/sportsRun";
import { BasketballMarket, parseBasketballMarkets } from "../../src/reference/basketball";
import { isGem } from "../../src/alerts/gems";
import { CanonicalEvent } from "../../src/types";

// The exchange's searches and prices of every head-to-head sport (4/10/2026),
// its matches moved to start in 5 hours.
const FIXTURES = join(__dirname, "fixtures");
const read = (name: string) => JSON.parse(gunzipSync(readFileSync(join(FIXTURES, name))).toString());
const NOW = new Date();
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const KICK_OFF = new Date(NOW.getTime() + 5 * 3600e3);
const ANSWERS = new Map<string, unknown>(
  (
    read("exchange-sports-search.json.gz") as {
      term: string;
      body: { content: { openDate: number }[] };
    }[]
  ).map(({ term, body }) => [
    term,
    {
      ...body,
      content: body.content.map((e) => ({
        ...e,
        openDate: KICK_OFF.getTime(),
      })),
    },
  ])
);
const FRAMES = read("exchange-sports-frames.json.gz");

// Tampa Bay - Philadelphia's 60-minute 1X2 (the frames have its moneyline).
const HOCKEY_1X2: MarketPrices = {
  runners: new Map([
    [25609, { back: 1.8, lay: 1.85, backSize: 50, laySize: 40 }],
    [25589, { back: 4.0, lay: 4.2, backSize: 30, laySize: 20 }],
    [60104, { back: 4.4, lay: 4.6, backSize: 25, laySize: 25 }],
  ]),
  matched: 1200,
};

function match(
  id: string,
  sport: string,
  participants: string[],
  odds: Record<string, number>,
  startTime = KICK_OFF
): CanonicalEvent {
  const market = "X" in odds ? "1X2" : "Vainqueur du match";
  return {
    id,
    sport,
    competition: "",
    startTime: startTime.toISOString(),
    participants,
    byBookmaker: {
      winamax: Object.entries(odds).map(([selection, price]) => ({
        market,
        selection,
        price,
      })),
    },
  };
}

describe("the other sports' reference cycle", () => {
  let db: DatabaseSync;
  let searches: string[];
  const search = async (query: string) => {
    searches.push(query);
    return ANSWERS.get(query) ?? { content: [] };
  };
  const prices = async () => new Map([...parsePriceFrames(FRAMES), ["1.263351033", HOCKEY_1X2]]);
  // The exchange's basketball markets are stubbed too: left to the default, the cycle
  // asks the real exchange, which fails at once from a machine it refuses and takes
  // seconds to answer from the CI's (a 5 s timeout).
  const cycle = (now = NOW, searchedAt = new Map<string, number>()) =>
    runSportsReferenceCycle(db, {
      search,
      prices,
      markets: async () => [],
      now,
      oddsMaxAgeMs: 24 * 3600e3,
      searchedAt,
    });
  const rows = () =>
    db.prepare("SELECT event_id AS e, market, selection, fair FROM reference_markets ORDER BY e, selection").all() as {
      e: string;
      market: string;
      selection: string;
      fair: number | null;
    }[];

  beforeEach(() => {
    db = openDb(":memory:");
    searches = [];
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("places a basketball match by its home team, the US way round, and prices its winner", async () => {
    upsertCanonicalEvents(db, [
      match("gsv", "basketball", ["Golden State Valkyries", "Las Vegas Aces"], {
        "1": 2.05,
        "2": 1.9,
      }),
    ]);
    await cycle();
    expect(searches).toEqual(["valkyries"]);
    expect(db.prepare("SELECT market_id AS m, selections AS s FROM reference_sources").get()).toEqual({
      m: "1.263275130",
      s: JSON.stringify({ "1": 75136141, "2": 18147292 }),
    });
    const total = 1 / 1.975 + 1 / 2.03;
    expect(rows()).toEqual([
      {
        e: "gsv",
        market: "Vainqueur du match",
        selection: "1",
        fair: expect.closeTo(1.975 * total, 9),
      },
      {
        e: "gsv",
        market: "Vainqueur du match",
        selection: "2",
        fair: expect.closeTo(2.03 * total, 9),
      },
    ]);

    // Found once: priced again, not searched again; its prices kept when
    // the exchange doesn't answer.
    await runSportsReferenceCycle(db, {
      search,
      prices: async () => new Map(),
      markets: async () => [],
      now: later(5),
      oddsMaxAgeMs: 24 * 3600e3,
    });
    expect(rows()).toHaveLength(2);
    await cycle(later(10));
    expect(searches).toEqual(["valkyries"]);

    const listed = getLatestEvents(db, { sport: "basketball", sort: "value" }).events[0];
    expect(listed.reference?.fair["1"]).toBeCloseTo(1.975 * total, 9);
    expect(listed.value).toMatchObject({
      selection: "1",
      bookmaker: "winamax",
      edge: expect.closeTo(2.05 / (1.975 * total) - 1, 9),
    });
    expect(getValueBets(db, {}).bets.map((b) => [b.market, b.marketLabel, b.label, b.basis])).toEqual([
      ["Vainqueur du match", "Sieger (inkl. Verlängerung)", "Golden State Valkyries", "fair"],
    ]);
  });

  it("keeps each runner on its team when our match lists its teams the other way round later", async () => {
    upsertCanonicalEvents(db, [
      match("gsv", "basketball", ["Golden State Valkyries", "Las Vegas Aces"], { "1": 2.05, "2": 1.9 }),
    ]);
    await cycle();
    // The same match (the same id), the Aces now first.
    upsertCanonicalEvents(db, [
      match("gsv", "basketball", ["Las Vegas Aces", "Golden State Valkyries"], { "1": 1.9, "2": 2.05 }),
    ]);
    await cycle(later(5));
    expect(searches).toEqual(["valkyries"]);
    expect(db.prepare("SELECT selections AS s FROM reference_sources").get()).toEqual({
      s: JSON.stringify({ "1": 18147292, "2": 75136141 }),
    });
    const total = 1 / 1.975 + 1 / 2.03;
    expect(rows().map((r) => [r.selection, r.fair])).toEqual([
      ["1", expect.closeTo(2.03 * total, 9)],
      ["2", expect.closeTo(1.975 * total, 9)],
    ]);
  });

  it("prices an ice hockey match's 1X2, the exchange's tie as the draw", async () => {
    const tbl = match("tbl", "hockey sur glace", ["Tampa Bay Lightning", "Philadelphia Flyers"], { "1": 1.95, X: 4.3, "2": 3.9 });
    // Betclic's winner, overtime and shootout included: 2.60 on Tampa Bay is
    // not 40% above its 60-minute fair odds.
    tbl.byBookmaker.betclic = [
      { market: "Vainqueur du match", selection: "1", price: 2.6 },
      { market: "Vainqueur du match", selection: "2", price: 1.5 },
    ];
    upsertCanonicalEvents(db, [tbl]);
    await cycle();
    const total = 1 / 1.825 + 1 / 4.1 + 1 / 4.5;
    expect(rows().map((r) => [r.selection, r.fair])).toEqual([
      ["1", expect.closeTo(1.825 * total, 9)],
      ["2", expect.closeTo(4.1 * total, 9)],
      ["X", expect.closeTo(4.5 * total, 9)],
    ]);
    // Winamax's 1.95 on Tampa Bay, 5.4% above its fair 1.85: a gem.
    const bets = getValueBets(db, {}).bets;
    expect(bets.map((b) => [b.market, b.marketLabel, b.label, Number(b.edge.toFixed(3))])).toEqual([
      ["1X2", "Spielergebnis (1X2)", "Tampa Bay Lightning", 0.054],
    ]);
    expect(isGem(bets[0])).toBe(true);
    const detail = getEventDetail(db, "tbl")!;
    const outcomes = detail.sections.flatMap((s) => s.markets).find((m) => m.key === "1X2")!.lines[0].outcomes;
    expect(outcomes.map((o) => [o.key, Number(o.fair?.toFixed(3))])).toEqual([
      ["1", 1.851],
      ["X", 4.563],
      ["2", 4.158],
    ]);
    const winner = detail.sections.flatMap((s) => s.markets).find((m) => m.key === "Vainqueur du match")!;
    expect(winner.lines[0].outcomes.map((o) => [o.key, o.fair, o.edges])).toEqual([
      ["1", undefined, undefined],
      ["2", undefined, undefined],
    ]);
    expect(getLatestEvents(db, { sport: "hockey sur glace", sort: "value" }).events[0].value).toMatchObject({ bookmaker: "winamax" });
  });

  it("finds a fight by its fighters' names, hours apart", async () => {
    upsertCanonicalEvents(db, [
      match("av", "mma", ["Alexander Volkanovski", "Movsar Evloev"], { "1": 2.2, "2": 1.75 }, later(240)),
    ]);
    await cycle();
    expect(searches).toEqual(["volkanovski"]);
    expect(rows().map((r) => r.selection)).toEqual(["1", "2"]);
    // Volkanovski 2.04 / 2.14 on the exchange: "1" is his.
    expect(rows()[0].fair).toBeGreaterThan(rows()[1].fair!);
  });

  it("searches a fighter by their surname", async () => {
    // The exchange finds "Petr Yan v Merab Dvalishvili" by "yan" as by "petr".
    ANSWERS.set("yan", ANSWERS.get("petr"));
    upsertCanonicalEvents(db, [
      match("py", "mma", ["Petr Yan", "Merab Dvalishvili"], {
        "1": 1.5,
        "2": 2.4,
      }),
    ]);
    await cycle();
    expect(searches).toEqual(["yan"]);
    expect(rows().map((r) => r.selection)).toEqual(["1", "2"]);
  });

  it("shows no reference for a 1X2 short of its draw's fair odds", () => {
    upsertCanonicalEvents(db, [
      match("h", "hockey sur glace", ["A", "B"], { "1": 2, X: 4, "2": 3 }),
      match("w", "basketball", ["C", "D"], { "1": 2, "2": 2 }),
    ]);
    const at = new Date().toISOString();
    saveReferenceMarkets(
      db,
      "h",
      [
        { market: "1X2", selection: "1", fair: 2.1, matched: 10 },
        { market: "1X2", selection: "2", fair: 3.1, matched: 10 },
      ],
      at
    );
    saveReferenceMarkets(
      db,
      "w",
      [
        {
          market: "Vainqueur du match",
          selection: "1",
          fair: 2.1,
          matched: 10,
        },
        {
          market: "Vainqueur du match",
          selection: "2",
          fair: 1.9,
          matched: 10,
        },
      ],
      at
    );
    expect([...loadReferences(db, ["h", "w"], new Date(NOW.getTime() - 60_000).toISOString()).keys()]).toEqual(["w"]);
  });

  it("keeps a market's prices without fair odds when they are too thin", async () => {
    // Stade Français - Montpellier: no lay on the draw.
    upsertCanonicalEvents(db, [
      match("sfm", "rugby à xv", ["Stade Français", "Montpellier"], {
        "1": 1.3,
        X: 19.75,
        "2": 3.23,
      }),
    ]);
    await cycle();
    expect(searches).toEqual(["francais"]);
    expect(rows().map((r) => [r.market, r.selection, r.fair])).toEqual([
      ["1X2", "1", null],
      ["1X2", "2", null],
      ["1X2", "X", null],
    ]);
    expect(getLatestEvents(db, { sport: "rugby à xv" }).events[0].reference).toBeNull();
  });

  it("searches a match the exchange doesn't list again after half an hour only, within 60 searches a cycle", async () => {
    upsertCanonicalEvents(
      db,
      Array.from({ length: 40 }, (_, i) =>
        match(`u${i}`, "baseball", [`Unknown${i} Alphas`, `Nobody${i} Betas`], {
          "1": 1.9,
          "2": 1.9,
        })
      )
    );
    const searchedAt = new Map<string, number>();
    await cycle(NOW, searchedAt);
    // 30 matches, 2 searches each.
    expect(searches).toHaveLength(60);
    await cycle(later(10), searchedAt);
    // The 10 left only.
    expect(searches).toHaveLength(80);
    await cycle(later(20), searchedAt);
    expect(searches).toHaveLength(80);
    await cycle(later(41), searchedAt);
    expect(searches).toHaveLength(140);
  });

  it("leaves football, tennis and the sports without a reference to others", async () => {
    upsertCanonicalEvents(db, [
      match("f", "football", ["Paris SG", "Marseille"], {
        "1": 1.5,
        X: 4,
        "2": 6,
      }),
      match("t", "tennis", ["Iga Swiatek", "Donna Vekic"], {
        "1": 1.1,
        "2": 7,
      }),
      match("b", "boxe", ["Tyson Fury", "Anthony Joshua"], {
        "1": 1.5,
        "2": 2.5,
      }),
    ]);
    await cycle();
    expect(searches).toEqual([]);
  });

  it("is the sports list the site sorts by value", () => {
    // web/src/sports.ts can't import the backend: its list is kept in step here.
    const web = readFileSync(join(__dirname, "../../web/src/sports.ts"), "utf8");
    const list = /const SPORTS_WITH_REFERENCE = new Set\(\[([^\]]*)\]\)/.exec(web)![1];
    const sports = [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(sports.sort()).toEqual(["football", "tennis", ...REFERENCE_SPORTS].sort());
  });
});

describe("a basketball match's handicap and total points on the exchange", () => {
  // FC Barcelona v BC Zalgiris Kaunas (9/10/2026): its search, its three
  // markets (event/details) and their price frames, moved to tip off in 5 hours.
  const search = read("exchange-basketball-search.json.gz") as { content: { openDate: number }[] };
  const answer = { ...search, content: search.content.map((e) => ({ ...e, openDate: KICK_OFF.getTime() })) };
  const DETAILS = read("exchange-basketball-details.json.gz");
  const FRAMES_BASKET = read("exchange-basketball-frames.json.gz");
  let db: DatabaseSync;
  let listed: string[];
  const markets = async (exchangeEventId: string): Promise<BasketballMarket[]> => {
    listed.push(exchangeEventId);
    return parseBasketballMarkets(DETAILS);
  };
  const barca: CanonicalEvent = {
    id: "barca",
    sport: "basketball",
    competition: "Euroligue",
    startTime: KICK_OFF.toISOString(),
    participants: ["FC Barcelone", "Zalgiris Kaunas"],
    byBookmaker: {
      winamax: [
        { market: "Vainqueur du match", selection: "1", price: 1.72 },
        { market: "Vainqueur du match", selection: "2", price: 1.98 },
      ],
    },
  };
  const cycle = (now = NOW, listings = new Map()) =>
    runSportsReferenceCycle(db, {
      search: async () => answer,
      markets,
      listings,
      prices: async () => parsePriceFrames(FRAMES_BASKET),
      now,
      oddsMaxAgeMs: 24 * 3600e3,
      searchedAt: new Map(),
    });
  const stored = () =>
    db.prepare("SELECT market, selection FROM reference_markets WHERE event_id = 'barca' ORDER BY market, selection").all() as {
      market: string;
      selection: string;
    }[];
  // The lines the bookmakers list: a handicap and a total of the exchange's 72 and 141.
  const bookmakersLines = () =>
    saveMarketOdds(
      db,
      [
        {
          eventId: "barca",
          bookmakerId: "winamax",
          odds: [
            { market: "spread|-6.5", selection: "1", price: 2.45 },
            { market: "spread|-6.5", selection: "2", price: 1.33 },
            { market: "total_points|174.5", selection: "over", price: 1.76 },
            { market: "total_points|174.5", selection: "under", price: 1.7 },
            // A line the exchange doesn't have (a quarter's), and a family it doesn't price.
            { market: "q1_total_points|42.5", selection: "over", price: 1.46 },
            { market: "team_points@1|87.5", selection: "over", price: 1.72 },
          ],
        },
      ],
      NOW.toISOString()
    );

  beforeEach(() => {
    db = openDb(":memory:");
    listed = [];
    vi.spyOn(console, "log").mockImplementation(() => {});
    upsertCanonicalEvents(db, [barca]);
  });

  it("prices the lines the bookmakers list, beside the winner, in one write", async () => {
    bookmakersLines();
    await cycle();

    // The moneyline kept (a write replaces all of a match's rows), and only the lines asked for.
    expect(stored()).toEqual([
      { market: "Vainqueur du match", selection: "1" },
      { market: "Vainqueur du match", selection: "2" },
      { market: "spread|-6.5", selection: "1" },
      { market: "spread|-6.5", selection: "2" },
      { market: "total_points|174.5", selection: "over" },
      { market: "total_points|174.5", selection: "under" },
    ]);
    expect(listed).toEqual([DETAILS.eventInfo.id]);
  });

  it("gives the total points' fair odds: the money on its market lets the exchange's prices say something", async () => {
    bookmakersLines();
    await cycle();

    const total = db
      .prepare("SELECT selection, fair, back, lay FROM reference_markets WHERE event_id = 'barca' AND market = 'total_points|174.5'")
      .all() as { selection: string; fair: number | null; back: number | null; lay: number | null }[];
    expect(total).toHaveLength(2);
    for (const row of total) {
      expect(row.back).toBeGreaterThan(1);
      expect(row.lay).toBeGreaterThan(row.back!);
    }
    const [over, under] = [total.find((r) => r.selection === "over")!, total.find((r) => r.selection === "under")!];
    expect(over.fair).not.toBeNull();
    expect(1 / over.fair! + 1 / under.fair!).toBeCloseTo(1, 10);
  });

  it("shows them on the match's page, with the bookmakers' prices against them", async () => {
    bookmakersLines();
    await cycle();

    const detail = getEventDetail(db, "barca", { oddsMaxAgeMs: 24 * 3600e3, marketsMaxAgeMs: 24 * 3600e3 })!;
    const total = detail.sections.flatMap((s) => s.markets).find((m) => m.key === "total_points")!;
    const line = total.lines.find((l) => l.line === 174.5)!;
    const over = line.outcomes.find((o) => o.key === "over")!;
    expect(over.prices).toEqual({ winamax: 1.76 });
    expect(over.fair).toBeGreaterThan(1);
  });

  it("lists a match's markets once an hour, not at each cycle, and prices them at each", async () => {
    bookmakersLines();
    const listings = new Map();
    await cycle(NOW, listings);
    await cycle(later(5), listings);
    expect(listed).toHaveLength(1);
    await cycle(later(31), listings);
    expect(listed).toHaveLength(2);
    expect(stored()).toHaveLength(6);
  });

  it("leaves out a line the exchange greys out, as if it had no price, and keeps the others", async () => {
    bookmakersLines();
    // Barcelona -6.5 stays listed in the handicap, but is locked: nobody can take it.
    const frames = structuredClone(FRAMES_BASKET) as {
      marketDefinition: { marketType: string };
      rc: { id: number; hc: number; locked: boolean }[];
    }[];
    const handicap = frames.find((f) => f.marketDefinition.marketType === "HANDICAP")!;
    handicap.rc.find((r) => r.id === 278533 && r.hc === -6.5)!.locked = true;
    await runSportsReferenceCycle(db, {
      search: async () => answer,
      markets,
      listings: new Map(),
      prices: async () => parsePriceFrames(frames),
      now: NOW,
      oddsMaxAgeMs: 24 * 3600e3,
      searchedAt: new Map(),
    });

    expect(stored()).toEqual([
      { market: "Vainqueur du match", selection: "1" },
      { market: "Vainqueur du match", selection: "2" },
      { market: "spread|-6.5", selection: "2" },
      { market: "total_points|174.5", selection: "over" },
      { market: "total_points|174.5", selection: "under" },
    ]);
  });

  it("keeps the winner alone when no bookmaker lists a line yet, or the markets can't be listed", async () => {
    await cycle();
    expect(stored()).toEqual([
      { market: "Vainqueur du match", selection: "1" },
      { market: "Vainqueur du match", selection: "2" },
    ]);
    bookmakersLines();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await runSportsReferenceCycle(db, {
      search: async () => answer,
      markets: async () => {
        throw new Error("down");
      },
      listings: new Map(),
      prices: async () => parsePriceFrames(FRAMES_BASKET),
      now: NOW,
      oddsMaxAgeMs: 24 * 3600e3,
      searchedAt: new Map(),
    });
    expect(stored()).toHaveLength(2);
    expect(error).toHaveBeenCalled();
  });
});
