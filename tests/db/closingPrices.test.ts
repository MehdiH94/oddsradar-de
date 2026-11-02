import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client";
import { closingPrice } from "../../src/db/closingPrices";

const START = "2026-11-02T18:00:00.000Z";
const BEFORE = "2026-11-02T17:55:00.000Z";
const AFTER = "2026-11-02T18:05:00.000Z";

function setup() {
  const db = openDb(":memory:");
  db.exec("INSERT INTO bookmakers (id, name) VALUES ('twentybet', '20bet')");
  db.prepare("INSERT INTO events (id, sport, competition, start_time, participants) VALUES ('e1', 'football', 'Bundesliga', ?, '[]')").run(START);
  return db;
}

describe("closingPrice", () => {
  it("reads a bookmaker's back from its last read before kick-off, none after", () => {
    const db = setup();
    db.prepare("INSERT INTO event_bookmaker_odds (event_id, bookmaker_id, market, selection, price, scraped_at) VALUES ('e1', 'twentybet', '1X2', '1', 2.1, ?)").run(BEFORE);
    expect(closingPrice(db, "e1", START, { market: "1X2", selection: "1", source: "twentybet", side: "back" })).toBe(2.1);
    db.prepare("UPDATE event_bookmaker_odds SET scraped_at = ?").run(AFTER);
    expect(closingPrice(db, "e1", START, { market: "1X2", selection: "1", source: "twentybet", side: "back" })).toBeNull();
    expect(closingPrice(db, "e1", START, { market: "1X2", selection: "2", source: "twentybet", side: "back" })).toBeNull();
  });

  it("reads an exchange leg's lay or back from the exchange's last read, its 1X2 and its other markets", () => {
    const db = setup();
    db.prepare("INSERT INTO reference_odds (event_id, selection, fair, back, lay, matched, scraped_at) VALUES ('e1', '2', 3.45, 3.4, 3.5, 5000, ?)").run(BEFORE);
    db.prepare(
      "INSERT INTO reference_markets (event_id, market, selection, fair, back, lay, back_size, lay_size, matched, scraped_at) VALUES ('e1', 'over_under@2.5', 'over', 1.9, 1.88, 1.92, 100, 80, 900, ?)"
    ).run(BEFORE);
    expect(closingPrice(db, "e1", START, { market: "1X2", selection: "2", source: "exchange", side: "lay" })).toBe(3.5);
    expect(closingPrice(db, "e1", START, { market: "1X2", selection: "2", source: "exchange", side: "back" })).toBe(3.4);
    expect(closingPrice(db, "e1", START, { market: "over_under@2.5", selection: "over", source: "exchange", side: "lay" })).toBe(1.92);
    db.prepare("UPDATE reference_odds SET scraped_at = ?").run(AFTER);
    expect(closingPrice(db, "e1", START, { market: "1X2", selection: "2", source: "exchange", side: "lay" })).toBeNull();
  });
});
