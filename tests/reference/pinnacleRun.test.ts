import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../../src/db/client";
import { upsertCanonicalEvents } from "../../src/db/repository";
import { loadReferences, saveReferenceOdds } from "../../src/db/reference";
import { valueBetsOf } from "../../src/db/value";
import { runPinnacleCycle } from "../../src/reference/pinnacleRun";
import { PinnacleMatch } from "../../src/reference/pinnacle";
import { CanonicalEvent } from "../../src/types";

const NOW = new Date("2026-10-30T10:00:00.000Z");
const KICK_OFF = "2026-10-31T17:30:00.000Z";
const LONG_AGO = "2000-01-01T00:00:00.000Z";

function event(id: string, participants: string[], startTime = KICK_OFF, prices = [1.5, 4.6, 6.2]): CanonicalEvent {
  return {
    id,
    sport: "football",
    competition: "",
    startTime,
    participants,
    byBookmaker: {
      betclic: [
        { market: "1X2", selection: "1", price: prices[0] },
        { market: "1X2", selection: "X", price: prices[1] },
        { market: "1X2", selection: "2", price: prices[2] },
      ],
    },
  };
}

// Pinnacle's Bayern - Dortmund of 28/10/2026: -269, +451, +683.
const BAYERN_DORTMUND: PinnacleMatch = {
  id: "a1b2",
  participants: ["Bayern Munich", "Borussia Dortmund"],
  startTime: "2026-10-31T17:30:00Z",
  prices: { home: 1 + 100 / 269, draw: 5.51, away: 7.83 },
};

describe("runPinnacleCycle", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = openDb(":memory:");
  });

  const run = (matches: PinnacleMatch[]) => runPinnacleCycle(db, { matches: async () => matches, now: NOW, oddsMaxAgeMs: 10 * 365 * 24 * 3600_000 });

  it("finds our match on Pinnacle and makes its fair odds the reference, Pinnacle's prices kept for the control", async () => {
    upsertCanonicalEvents(db, [event("e1", ["Bayern Munich", "Borussia Dortmund"])], NOW.toISOString());
    expect(await run([BAYERN_DORTMUND])).toEqual({ targets: 1, placed: 1 });
    const reference = loadReferences(db, ["e1"], LONG_AGO).get("e1")!;
    expect(reference.source).toBe("pinnacle");
    expect(reference.market).toBe("1X2");
    expect(reference.sharp!["2"]).toBeCloseTo(7.83, 10);
    expect(1 / reference.fair["1"] + 1 / reference.fair.X + 1 / reference.fair["2"]).toBeCloseTo(1, 12);
    // The longshot's fair odds raised the most above Pinnacle's price.
    expect(reference.fair["2"] / 7.83).toBeGreaterThan(reference.fair["1"] / BAYERN_DORTMUND.prices.home);
  });

  it("puts Pinnacle's home side on our second participant when we list the match the other way round", async () => {
    upsertCanonicalEvents(db, [event("e1", ["Borussia Dortmund", "Bayern Munich"])], NOW.toISOString());
    await run([BAYERN_DORTMUND]);
    const reference = loadReferences(db, ["e1"], LONG_AGO).get("e1")!;
    expect(reference.sharp!["1"]).toBeCloseTo(7.83, 10);
    expect(reference.sharp!["2"]).toBeCloseTo(1 + 100 / 269, 10);
  });

  it("takes over from the exchange's fair odds, its matched volume kept, and leaves a match Pinnacle doesn't price to the exchange", async () => {
    upsertCanonicalEvents(
      db,
      [event("e1", ["Bayern Munich", "Borussia Dortmund"]), event("e2", ["Union Berlin", "FC Koln"])],
      NOW.toISOString()
    );
    for (const id of ["e1", "e2"]) {
      saveReferenceOdds(
        db,
        id,
        { fair: { "1": 1.4, X: 5.2, "2": 7.5 }, back: { "1": 1.39, X: 5.1, "2": 7.4 }, lay: { "1": 1.41, X: 5.3, "2": 7.6 }, backSize: {}, laySize: {}, matched: 120000 },
        NOW.toISOString()
      );
    }
    await run([BAYERN_DORTMUND]);
    const references = loadReferences(db, ["e1", "e2"], LONG_AGO);
    expect(references.get("e1")).toMatchObject({ source: "pinnacle", matched: 120000 });
    expect(references.get("e2")).toMatchObject({ source: "exchange", fair: { "1": 1.4, X: 5.2, "2": 7.5 } });
    expect(references.get("e2")!.sharp).toBeUndefined();
  });

  it("finds nothing for a match Pinnacle lists at another time or under other teams", async () => {
    upsertCanonicalEvents(db, [event("e1", ["Bayern Munich", "Borussia Dortmund"])], NOW.toISOString());
    expect(await run([{ ...BAYERN_DORTMUND, startTime: "2026-10-31T21:30:00Z" }])).toEqual({ targets: 1, placed: 0 });
    expect(await run([{ ...BAYERN_DORTMUND, participants: ["Hertha Berlin", "Hamburger SV"] }])).toEqual({ targets: 1, placed: 0 });
    expect(loadReferences(db, ["e1"], LONG_AGO).get("e1")).toBeUndefined();
  });
});

describe("a value bet against Pinnacle's fair odds", () => {
  const reference = {
    market: "1X2",
    // PasBet's two-outcome example: 2.05 and 1.90, fair 2.0801 on the first.
    fair: { "1": 2.0801, "2": 1.8937 },
    sharp: { "1": 2.05, "2": 1.9 },
  };
  const match = (price: number): CanonicalEvent["byBookmaker"] => ({ betclic: [{ market: "1X2", selection: "1", price }] });
  const bets = (price: number) =>
    valueBetsOf({ byBookmaker: { betclic: { odds: match(price).betclic } } } as never, reference);

  it("is one from 1% over the fair odds when the control payout with Pinnacle's other prices is 99% or more", () => {
    // 2.15: +3.4%, its control payout 100.86%.
    expect(bets(2.15).map((b) => [b.selection, b.price])).toEqual([["1", 2.15]]);
  });

  it("is none under the control payout, however far over the fair odds", () => {
    // Pinnacle's other price so low that no price on the first makes a 99% market.
    const wide = { ...reference, sharp: { "1": 2.05, "2": 1.5 }, fair: { "1": 2.0, "2": 2.0 } };
    expect(valueBetsOf({ byBookmaker: { betclic: { odds: match(2.6).betclic } } } as never, wide)).toEqual([]);
  });
});
