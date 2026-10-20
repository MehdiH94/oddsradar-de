import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client";
import { DOWN_AFTER_MS, listBookmakerStatus, recordBookmakerRead } from "../../src/db/bookmakerStatus";

const T0 = Date.parse("2026-10-20T10:00:00.000Z");
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

describe("the bookmakers' last reads", () => {
  it("keeps each one's last read, and its last good one through failures", () => {
    const db = openDb(":memory:");
    recordBookmakerRead(db, "betway", { events: 950 }, at(0));
    recordBookmakerRead(db, "betway", { error: "betway GetGroup: HTTP 503" }, at(5));

    const [betway] = listBookmakerStatus(db, T0 + 6 * 60_000);
    expect(betway).toMatchObject({
      bookmaker: "betway",
      lastReadAt: at(5),
      lastEvents: null,
      lastError: "betway GetGroup: HTTP 503",
      lastGoodAt: at(0),
      lastGoodEvents: 950,
      health: "failing",
      downAlerted: false,
    });
  });

  it("calls a bookmaker down after 30 minutes without a match, an empty read as much as a failed one", () => {
    const db = openDb(":memory:");
    recordBookmakerRead(db, "oddset", { events: 800 }, at(0));
    recordBookmakerRead(db, "oddset", { events: 0 }, at(10));
    expect(listBookmakerStatus(db, T0 + 10 * 60_000)[0].health).toBe("empty");
    expect(listBookmakerStatus(db, T0 + DOWN_AFTER_MS)[0].health).toBe("down");
    // Never a good read: down at once.
    recordBookmakerRead(db, "neobet", { error: "refused" }, at(10));
    expect(listBookmakerStatus(db, T0 + 10 * 60_000).find((b) => b.bookmaker === "neobet")?.health).toBe("down");
    // A good read again: ok, its error forgotten.
    recordBookmakerRead(db, "oddset", { events: 790 }, at(40));
    expect(listBookmakerStatus(db, T0 + 40 * 60_000).find((b) => b.bookmaker === "oddset")).toMatchObject({ health: "ok", lastError: null, lastGoodAt: at(40) });
  });
});
