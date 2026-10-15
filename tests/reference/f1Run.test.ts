import { describe, it, expect, beforeEach, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../../src/db/client";
import { upsertCanonicalEvents } from "../../src/db/repository";
import { matchEvents } from "../../src/matcher/match";
import { MARKET_OUTRIGHT } from "../../src/scraper/canonical";
import { parsePriceFrames } from "../../src/reference/exchange";
import { runF1ReferenceCycle } from "../../src/reference/f1Run";
import { RawEvent } from "../../src/types";

const DRIVERS = ["Max Verstappen", "Lando Norris", "Charles Leclerc"];
const NOW = new Date();
const at = (hours: number) => new Date(NOW.getTime() + hours * 3600e3).toISOString();
const ours = (title: string, hours: number): RawEvent => ({
  sport: "formule 1",
  competition: "Formule 1",
  startTime: at(hours),
  participants: [title],
  odds: DRIVERS.map((selection, i) => ({ market: MARKET_OUTRIGHT, selection, price: 2 + i })),
});
const runners = DRIVERS.map((runnerName, i) => ({ selectionId: i + 1, runnerName }));
const market = (marketId: string, marketName: string, marketType = "WINNER") => ({ marketId, marketName, description: { marketType }, runners });
const frame = (id: string, backs: number[]) => ({
  id,
  rc: backs.map((b, i) => ({ id: i + 1, atb: [[b, 500]], atl: [[b * 1.02, 500]] })),
  tv: 1000,
});

describe("the F1 reference cycle", () => {
  let db: DatabaseSync;
  const rows = () =>
    db
      .prepare("SELECT e.participants AS title, r.selection, r.fair FROM reference_markets r JOIN events e ON e.id = r.event_id ORDER BY e.id, r.selection")
      .all() as { title: string; selection: string; fair: number | null }[];
  const titles = () => [...new Set(rows().map((r) => JSON.parse(r.title)[0]))].sort();

  const GP = { id: "1.1", name: "Singapore Grand Prix", openDate: NOW.getTime() + 30 * 3600e3, inPlay: false };
  const SPRINT = { id: "1.2", name: "Singapore Grand Prix Sprint Race", openDate: NOW.getTime() + 6 * 3600e3, inPlay: false };
  const search = async () => ({
    content: [
      { ...GP, topMarkets: [market("1.100", "Winner")] },
      { ...SPRINT, topMarkets: [market("1.200", "Winner")] },
    ],
  });
  // Different prices per market: a pairing with the wrong one shows.
  const PRICES = parsePriceFrames([frame("1.100", [2, 3, 6]), frame("1.200", [4, 4, 4]), frame("1.300", [5, 3, 3]), frame("1.400", [9, 9, 9])]);
  const details = async () => ({
    marketCatalogues: [market("1.300", "Overall Qualifying Winner", "OTHER"), market("1.400", "Sprint Qualifying Winner", "OTHER")],
  });
  const fairOf = (title: string) => rows().filter((r) => JSON.parse(r.title)[0] === title).map((r) => r.fair);
  const cycle = () => runF1ReferenceCycle(db, { search, details, prices: async () => PRICES, now: NOW, oddsMaxAgeMs: 10 * 365 * 24 * 3600e3 });

  beforeEach(() => {
    db = openDb(":memory:");
    vi.spyOn(console, "log").mockImplementation(() => {});
    upsertCanonicalEvents(
      db,
      matchEvents({
        betclic: [
          ours("Grand Prix de Singapour 2026 - Course", 30),
          ours("Grand Prix de Singapour 2026 - Sprint", 6),
          ours("Grand Prix de Singapour 2026 - Qualification", 20),
          ours("Grand Prix de Singapour 2026 - Sprint Qualifying", 2),
        ],
      })
    );
  });

  it("gives the race, the sprint and each qualifying session the prices of their own market", async () => {
    await cycle();
    expect(titles()).toEqual([
      "Grand Prix de Singapour 2026 - Course",
      "Grand Prix de Singapour 2026 - Qualification",
      "Grand Prix de Singapour 2026 - Sprint",
      "Grand Prix de Singapour 2026 - Sprint Qualifying",
    ]);
    // 4/4/4 and 9/9/9 are three even drivers; the others are not.
    const race = fairOf("Grand Prix de Singapour 2026 - Course");
    const sprint = fairOf("Grand Prix de Singapour 2026 - Sprint");
    const qualifying = fairOf("Grand Prix de Singapour 2026 - Qualification");
    const sprintQualifying = fairOf("Grand Prix de Singapour 2026 - Sprint Qualifying");
    expect(new Set(sprint).size).toBe(1);
    expect(new Set(sprintQualifying).size).toBe(1);
    expect(sprint[0]).not.toBeCloseTo(sprintQualifying[0]!, 1);
    expect(new Set(race).size).toBeGreaterThan(1);
    expect(qualifying).not.toEqual(race);
  });

  it("leaves a qualifying session without fair odds when the exchange lists none", async () => {
    await runF1ReferenceCycle(db, { search, details: async () => ({ marketCatalogues: [] }), prices: async () => PRICES, now: NOW, oddsMaxAgeMs: 10 * 365 * 24 * 3600e3 });
    expect(titles()).toEqual(["Grand Prix de Singapour 2026 - Course", "Grand Prix de Singapour 2026 - Sprint"]);
  });
});
