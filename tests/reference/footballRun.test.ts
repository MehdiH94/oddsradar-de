import { describe, it, expect, beforeEach, vi } from "vitest";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../../src/db/client";
import { getValueBets, saveMarketOdds, upsertCanonicalEvents } from "../../src/db/repository";
import { saveReferenceSource } from "../../src/db/reference";
import { getEventDetail } from "../../src/db/eventDetail";
import { parsePriceFrames } from "../../src/reference/exchange";
import { parseFootballMarkets } from "../../src/reference/football";
import { runFootballMarketsReferenceCycle } from "../../src/reference/footballRun";
import { CanonicalEvent } from "../../src/types";

// FC Heidenheim v Kaiserslautern on the exchange (8/10/2026): its markets and
// their prices.
const FIXTURES = join(__dirname, "fixtures");
const read = (name: string) => JSON.parse(gunzipSync(readFileSync(join(FIXTURES, name))).toString());
const DETAILS = read("exchange-football-details.json.gz");
const FRAMES = read("exchange-football-frames.json.gz");
const NOW = new Date();
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const kickOff = (hours: number) => new Date(NOW.getTime() + hours * 3600e3).toISOString();

const TEAMS = ["Heidenheim", "Kaiserslautern"];

function match(id: string, hours = 20, participants = TEAMS): CanonicalEvent {
  return {
    id,
    sport: "football",
    competition: "Bundesliga 2",
    startTime: kickOff(hours),
    participants,
    byBookmaker: {
      winamax: [
        { market: "1X2", selection: "1", price: 2.1 },
        { market: "1X2", selection: "X", price: 3.4 },
        { market: "1X2", selection: "2", price: 3.5 },
      ],
    },
  };
}

// The match is on the exchange as the football reference's main cycle placed
// it: our first team is the exchange's home side (FC Heidenheim, 3237590) unless `reversed`.
function place(db: DatabaseSync, id: string, reversed = false, exchangeEventId = "36103247") {
  saveReferenceSource(
    db,
    id,
    {
      exchangeEventId,
      marketId: "1.1",
      selections: reversed ? { "1": 14075, X: 58805, "2": 3237590 } : { "1": 3237590, X: 58805, "2": 14075 },
      participants: TEAMS,
    },
    NOW.toISOString()
  );
}

describe("the football markets reference cycle", () => {
  let db: DatabaseSync;
  let listed: string[];
  let priced: number[];
  const markets = async (id: string) => {
    listed.push(id);
    return parseFootballMarkets(DETAILS);
  };
  const prices = async (asked: { marketId: string; eventId: string }[]) => {
    priced.push(asked.length);
    return parsePriceFrames(FRAMES);
  };
  const cycle = (now = NOW) => runFootballMarketsReferenceCycle(db, { markets, prices, now, oddsMaxAgeMs: 24 * 3600e3 });
  const rows = (eventId = "m1") =>
    db
      .prepare("SELECT market, selection, fair, back, lay FROM reference_markets WHERE event_id = ?")
      .all(eventId) as { market: string; selection: string; fair: number | null; back: number | null; lay: number | null }[];

  beforeEach(() => {
    db = openDb(":memory:");
    listed = [];
    priced = [];
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("lists the markets of a match placed on the exchange and prices them, but not its 1X2", async () => {
    upsertCanonicalEvents(db, [match("m1")]);
    place(db, "m1");
    await cycle();

    expect(listed).toEqual(["36103247"]);
    const stored = rows();
    expect(stored.length).toBeGreaterThan(40);
    expect(stored.some((r) => r.market === "total_goals|2.5" && r.back !== null)).toBe(true);
    // The 1X2 is the main cycle's (reference_odds).
    expect(stored.some((r) => r.market === "1X2")).toBe(false);
    expect(stored.some((r) => r.fair !== null)).toBe(true);
    // The markets were all asked for at once.
    expect(priced).toHaveLength(1);
    expect(priced[0]).toBeGreaterThan(15);
  });

  it("lists a match's markets again after half an hour only, and keeps the last list when it fails", async () => {
    upsertCanonicalEvents(db, [match("m1")]);
    place(db, "m1");
    await cycle();
    await cycle(later(10));
    expect(listed).toHaveLength(1);
    await cycle(later(31));
    expect(listed).toHaveLength(2);

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = (now: Date) =>
      runFootballMarketsReferenceCycle(db, {
        markets: async () => {
          throw new Error("HTTP 503");
        },
        prices,
        now,
        oddsMaxAgeMs: 24 * 3600e3,
      });
    await failing(later(70));
    expect(error).toHaveBeenCalled();
    // The previous list is still priced.
    expect(rows().length).toBeGreaterThan(40);
  });

  it("turns the exchange's teams round when our first team is its away side", async () => {
    upsertCanonicalEvents(db, [match("m1"), match("m2")]);
    place(db, "m1");
    place(db, "m2", true, "36103248");
    await cycle();
    const back = (id: string, market: string, selection: string) =>
      rows(id).find((r) => r.market === market && r.selection === selection)?.back;
    // The exchange lists both teams at every line: its "FC Heidenheim -1.5" is
    // our first team's at -1.5 when it is the home side, our second team's at
    // +1.5 when it is not.
    expect(back("m1", "handicap|-1.5", "1")).toBeDefined();
    expect(back("m2", "handicap|1.5", "2")).toBe(back("m1", "handicap|-1.5", "1"));
    // "Draw or Away" is "X2" for the home side's, and "1X" for the away side's.
    expect(back("m1", "double_chance", "X2")).toBeDefined();
    expect(back("m2", "double_chance", "1X")).toBe(back("m1", "double_chance", "X2"));
  });

  it("leaves out a match the exchange does not list, one beyond 24 hours, and the 1X2 ones without a source", async () => {
    upsertCanonicalEvents(db, [match("m1"), match("far", 30), match("lonely")]);
    place(db, "m1");
    place(db, "far");
    await cycle();
    expect(listed).toEqual(["36103247"]);
    expect(rows("far")).toEqual([]);
    expect(rows("lonely")).toEqual([]);
  });

  it("prices the 25 nearest matches at most", async () => {
    const events = Array.from({ length: 30 }, (_, i) => match(`e${i}`, 1 + i * 0.5));
    upsertCanonicalEvents(db, events);
    events.forEach((e, i) => place(db, e.id, false, `x${i}`));
    await cycle();
    expect(listed).toHaveLength(25);
    expect(listed[0]).toBe("x0");
    expect(rows("e24").length).toBeGreaterThan(0);
    expect(rows("e25")).toEqual([]);
  });

  describe("its value bets", () => {
    beforeEach(async () => {
      upsertCanonicalEvents(db, [match("m1")]);
      place(db, "m1");
      await cycle();
    });

    // (The 2.5 line of the capture has 2.42 EUR on one side: no fair odds.)
    it("marks a bookmaker's price above an outcome's fair odds on the match's page, and lists it as a value bet", () => {
      const fair = rows().find((r) => r.market === "total_goals|1.5" && r.selection === "over")!.fair;
      expect(fair).not.toBeNull();
      saveMarketOdds(
        db,
        [
          {
            eventId: "m1",
            bookmakerId: "winamax",
            odds: [
              { market: "total_goals|1.5", selection: "over", price: Math.round(fair! * 1.12 * 100) / 100 },
              { market: "total_goals|1.5", selection: "under", price: 1.2 },
            ],
          },
        ],
        new Date().toISOString()
      );
      const detail = getEventDetail(db, "m1")!;
      const market = detail.sections.flatMap((s) => s.markets).find((m) => m.key === "total_goals")!;
      const over = market.lines.find((l) => l.line === 1.5)!.outcomes.find((o) => o.key === "over")!;
      expect(over.fair).toBeCloseTo(fair!, 2);
      expect(over.edges.winamax).toBeGreaterThan(0.1);
      const bets = getValueBets(db, { sort: "value" }).bets;
      expect(bets.some((b) => b.eventId === "m1" && b.market === "total_goals|1.5" && b.basis === "fair")).toBe(true);
    });
  });
});
