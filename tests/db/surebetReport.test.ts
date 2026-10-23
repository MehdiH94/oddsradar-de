import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../../src/db/client";
import { upsertCanonicalEvents } from "../../src/db/repository";
import { saveReferenceOdds } from "../../src/db/reference";
import { currentSurebetReadGaps, formatSurebetReport, sentSurebetsByPair, sourcePair } from "../../src/db/surebetReport";

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600e3).toISOString();
const oneXTwo = (one: number) => [
  { market: "1X2", selection: "1", price: one },
  { market: "1X2", selection: "X", price: 3.4 },
  { market: "1X2", selection: "2", price: 3.6 },
];

describe("sourcePair", () => {
  it("names a surebet's sources and sides, sorted, each once", () => {
    expect(sourcePair([{ source: "twentybet", side: "back" }, { source: "exchange", side: "lay" }])).toBe("exchange lay + twentybet back");
    expect(sourcePair([{ source: "leovegas", side: "back" }, { source: "leovegas", side: "back" }, { source: "betway", side: "back" }])).toBe(
      "betway back + leovegas back"
    );
  });
});

describe("the surebet report", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = openDb(":memory:");
    // 20bet's 2.3 on "1" backed, laid at 2.1 on the exchange: 107.8 %.
    upsertCanonicalEvents(db, [
      {
        id: "fcb-ars",
        sport: "football",
        competition: "Champions League",
        startTime: hoursFromNow(5),
        participants: ["Bayern München", "Arsenal"],
        byBookmaker: { twentybet: oneXTwo(2.3), leovegas: oneXTwo(2.0) },
      },
    ]);
    const fair = { "1": 2.05, X: 3.6, "2": 3.9 };
    const lay = { "1": 2.1, X: 3.7, "2": 4 };
    saveReferenceOdds(db, "fcb-ars", { fair, back: fair, lay, laySize: { "1": 300, X: 300, "2": 300 }, backSize: { "1": 300, X: 300, "2": 300 }, matched: 5000 }, new Date().toISOString());
  });

  it("counts the surebets sent to Discord by sources, since a date", () => {
    const insert = db.prepare(
      `INSERT INTO gem_alerts (event_id, market, selection, bookmaker, basis, price, fair, edge, label, market_label, match_label, start_time, sent_at)
       VALUES (@id, '1X2', 'surebet', @bookmaker, 'surebet:lay', 1, 1, @edge, '', '', '', '', @sentAt)`
    );
    insert.run({ id: "a", bookmaker: "1@twentybet:back,1@exchange:lay", edge: 0.04, sentAt: "2026-10-21T10:00:00.000Z" });
    insert.run({ id: "b", bookmaker: "2@twentybet:back,2@exchange:lay", edge: 0.02, sentAt: "2026-10-22T10:00:00.000Z" });
    insert.run({ id: "c", bookmaker: "1@leovegas:back,X@betway:back,2@twentybet:back", edge: 0.01, sentAt: "2026-10-22T11:00:00.000Z" });
    insert.run({ id: "d", bookmaker: "1@twentybet:back,1@exchange:lay", edge: 0.05, sentAt: "2026-10-01T10:00:00.000Z" });

    expect(sentSurebetsByPair(db, "2026-10-20T00:00:00.000Z")).toEqual([
      { pair: "exchange lay + twentybet back", count: 2, meanEdge: expect.closeTo(0.03, 10) },
      { pair: "betway back + leovegas back + twentybet back", count: 1, meanEdge: expect.closeTo(0.01, 10) },
    ]);
  });

  it("gives each surebet shown its legs' read times and how far apart they are", () => {
    db.prepare("UPDATE event_bookmaker_odds SET scraped_at = @at WHERE bookmaker_id = 'twentybet'").run({
      at: new Date(Date.now() - 12 * 60_000).toISOString(),
    });
    const [gap] = currentSurebetReadGaps(db);
    expect(gap.pair).toBe("exchange lay + twentybet back");
    expect(gap.surebet.legs.map((l) => l.source)).toEqual(["twentybet", "exchange"]);
    expect(gap.readAt.every((at) => at !== null)).toBe(true);
    expect(gap.gapMinutes).toBeCloseTo(12, 0);

    const text = formatSurebetReport([], [gap], "2026-10-20T00:00:00.000Z");
    expect(text).toContain("Surebets sent to Discord since 2026-10-20T00:00:00.000Z, by sources:\n  none");
    expect(text).toContain("1 × exchange lay + twentybet back (mean profit 7.8%, read gap median 12.0 min, max 12.0 min)");
    expect(text).toContain("back Bayern München @ twentybet 2.3, read");
    expect(text).toContain("lay Bayern München @ exchange 2.1 (300 € on it), read");
  });
});
