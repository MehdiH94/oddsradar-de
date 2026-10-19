import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../../src/db/client";
import { getLatestEvents } from "../../src/db/repository";
import { runScrapeCycle, BookmakerScraper } from "../../src/scraper/run";
import { listBookmakerStatus } from "../../src/db/bookmakerStatus";
import { RawEvent } from "../../src/types";

// Relative to "now" rather than a fixed date: getLatestEvents only returns
// events that have not already finished (see src/db/repository.ts), so a
// hard-coded past timestamp would make these tests start failing on their own
// once the wall clock moved past it.
const sampleEvent: RawEvent = {
  sport: "football",
  competition: "Ligue 1",
  startTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  participants: ["PSG", "OM"],
  odds: [{ market: "1X2", selection: "1", price: 1.5 }],
};

describe("runScrapeCycle", () => {
  let db: DatabaseSync;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Every failing-scraper case now logs a retry warning (see fetchWithRetry);
    // silence it so the suite output stays readable.
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    db?.close();
    vi.restoreAllMocks();
  });

  it("stores events from succeeding scrapers even when another scraper fails", async () => {
    db = openDb(":memory:");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const scrapers: BookmakerScraper[] = [
      { id: "winamax", fetch: async () => [sampleEvent] },
      {
        id: "betclic",
        fetch: async () => {
          throw new Error("betclic.fr changed its markup");
        },
      },
    ];

    await runScrapeCycle(db, scrapers);

    const { events } = getLatestEvents(db);
    expect(events).toHaveLength(1);
    expect(events[0].byBookmaker.winamax).toBeDefined();
    expect(events[0].byBookmaker.betclic).toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledOnce();

    consoleErrorSpy.mockRestore();
  });

  it("isolates a scraper that throws synchronously instead of returning a rejected promise", async () => {
    db = openDb(":memory:");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const scrapers: BookmakerScraper[] = [
      { id: "winamax", fetch: async () => [sampleEvent] },
      {
        id: "betclic",
        // Deliberately NOT declared `async` -- throws synchronously the moment
        // fetch() is called, before returning any promise at all.
        fetch: () => {
          throw new Error("betclic.fr's parser crashed before awaiting anything");
        },
      },
    ];

    await runScrapeCycle(db, scrapers);

    const { events } = getLatestEvents(db);
    expect(events).toHaveLength(1);
    expect(events[0].byBookmaker.winamax).toBeDefined();
    expect(events[0].byBookmaker.betclic).toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledOnce();

    consoleErrorSpy.mockRestore();
  });

  it("retries a scraper that fails once and includes its data when the retry succeeds", async () => {
    db = openDb(":memory:");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    let attempts = 0;
    const scrapers: BookmakerScraper[] = [
      {
        id: "betclic",
        fetch: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error("transient network blip");
          return [sampleEvent];
        },
      },
    ];

    await runScrapeCycle(db, scrapers);

    expect(attempts).toBe(2);
    const { events } = getLatestEvents(db);
    expect(events).toHaveLength(1);
    // The whole point: a transient first failure must NOT be treated as a
    // failed bookmaker for the cycle.
    expect(events[0].byBookmaker.betclic).toBeDefined();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledOnce();

    consoleErrorSpy.mockRestore();
  });

  it("gives up and isolates a scraper that fails every attempt", async () => {
    db = openDb(":memory:");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    let attempts = 0;
    const scrapers: BookmakerScraper[] = [
      { id: "winamax", fetch: async () => [sampleEvent] },
      {
        id: "betclic",
        fetch: async () => {
          attempts += 1;
          throw new Error("betclic.fr is down");
        },
      },
    ];

    await runScrapeCycle(db, scrapers);

    // Original attempt plus exactly one retry -- then give up for this cycle.
    expect(attempts).toBe(2);
    const { events } = getLatestEvents(db);
    expect(events).toHaveLength(1);
    expect(events[0].byBookmaker.winamax).toBeDefined();
    expect(events[0].byBookmaker.betclic).toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledOnce();

    consoleErrorSpy.mockRestore();
  });

  it("records each bookmaker's read: its matches, or its error", async () => {
    db = openDb(":memory:");
    vi.spyOn(console, "error").mockImplementation(() => {});
    await runScrapeCycle(db, [
      { id: "winamax", fetch: async () => [sampleEvent] },
      { id: "betclic", fetch: async () => { throw new Error("HTTP 503"); } },
    ]);
    const status = Object.fromEntries(listBookmakerStatus(db).map((s) => [s.bookmaker, s]));
    expect(status.winamax).toMatchObject({ lastEvents: 1, lastError: null, health: "ok" });
    expect(status.betclic).toMatchObject({ lastEvents: null, lastError: "HTTP 503", health: "down" });
  });
});
