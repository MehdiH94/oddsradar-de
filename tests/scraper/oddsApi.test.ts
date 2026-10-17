import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOddsApi, ODDS_API_COMPETITIONS, OddsApiEvent, parseOddsApiEvents } from "../../src/scraper/oddsApi";

// A real answer of The Odds API (soccer_germany_bundesliga/odds, Tipico's and
// Winamax.de's head-to-head prices, 17/10/2026), its first 6 matches.
const BUNDESLIGA: OddsApiEvent[] = JSON.parse(readFileSync(join(__dirname, "fixtures/oddsapi-bundesliga.json"), "utf8"));
const NOW = Date.parse("2026-10-17T11:00:00Z");
const cacheFile = () => join(mkdtempSync(join(tmpdir(), "odds-api-")), "cache.json");

afterEach(() => vi.restoreAllMocks());

describe("parseOddsApiEvents", () => {
  it("reads a match's head-to-head prices for each bookmaker, labelled with the teams and Draw", () => {
    const tipico = parseOddsApiEvents(BUNDESLIGA, "tipico");
    expect(tipico[0]).toEqual({
      sport: "football",
      competition: "Bundesliga",
      startTime: "2026-10-17T13:30:00.000Z",
      participants: ["Elversberg", "Augsburg"],
      odds: [
        { market: "1X2", selection: "Augsburg", price: 2.55 },
        { market: "1X2", selection: "Elversberg", price: 2.5 },
        { market: "1X2", selection: "Draw", price: 3.8 },
      ],
      sourceId: "0bf757f3bd903496ce2fa27bd0481869",
    });
    const winamax = parseOddsApiEvents(BUNDESLIGA, "winamaxde");
    expect(winamax[0].odds.find((o) => o.selection === "Elversberg")?.price).toBe(2.4);
  });

  it("leaves out a match the bookmaker doesn't price", () => {
    const without = BUNDESLIGA.map((e, i) => (i === 0 ? { ...e, bookmakers: e.bookmakers?.filter((b) => b.key !== "tipico_de") } : e));
    expect(parseOddsApiEvents(without, "tipico")).toHaveLength(BUNDESLIGA.length - 1);
  });
});

// An API whose event list has a match tomorrow for the Bundesliga only.
function api(opts: { remaining?: string } = {}) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: URL | string) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    const sport = url.pathname.split("/")[3];
    if (url.pathname.endsWith("/events")) {
      const events = sport === "soccer_germany_bundesliga" ? [{ commence_time: "2026-10-18T13:30:00Z" }] : [];
      return new Response(JSON.stringify(events), { status: 200 });
    }
    return new Response(JSON.stringify(BUNDESLIGA), { status: 200, headers: { "x-requests-remaining": opts.remaining ?? "480" } });
  });
  return { fetchMock, calls };
}

describe("loadOddsApi", () => {
  it("spends a credit only on a competition with a match within 48 hours, then keeps it for the refresh time", async () => {
    const file = cacheFile();
    const { fetchMock, calls } = api();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const first = await loadOddsApi({ key: "k", cacheFile: file, now: () => NOW, fetch: fetchMock as unknown as typeof fetch });
    expect(calls.filter((p) => p.endsWith("/odds"))).toEqual(["/v4/sports/soccer_germany_bundesliga/odds"]);
    expect(calls.filter((p) => p.endsWith("/events"))).toHaveLength(Object.keys(ODDS_API_COMPETITIONS).length);
    // The Bundesliga's 6 matches, all still to start at NOW.
    expect(first).toHaveLength(6);

    // An hour later, from the file: no request.
    calls.length = 0;
    const later = await loadOddsApi({ key: "k", cacheFile: file, now: () => NOW + 60 * 60 * 1000, fetch: fetchMock as unknown as typeof fetch });
    expect(calls).toEqual([]);
    expect(later).toHaveLength(6);

    // Past the refresh time: read again.
    await loadOddsApi({ key: "k", cacheFile: file, now: () => NOW + 13 * 60 * 60 * 1000, fetch: fetchMock as unknown as typeof fetch });
    expect(calls.filter((p) => p.endsWith("/odds"))).toHaveLength(1);
  });

  it("drops the matches that have started from the prices it keeps", async () => {
    const { fetchMock } = api();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const events = await loadOddsApi({ key: "k", cacheFile: cacheFile(), now: () => Date.parse("2026-10-17T14:00:00Z"), fetch: fetchMock as unknown as typeof fetch });
    expect(events.every((e) => Date.parse(e.commence_time!) > Date.parse("2026-10-17T14:00:00Z"))).toBe(true);
    expect(events.length).toBeLessThan(6);
  });

  it("stops reading when the month's last credits are left", async () => {
    const file = cacheFile();
    const { fetchMock, calls } = api({ remaining: "10" });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await loadOddsApi({ key: "k", cacheFile: file, now: () => NOW, fetch: fetchMock as unknown as typeof fetch });
    calls.length = 0;
    await loadOddsApi({ key: "k", cacheFile: file, now: () => NOW + 13 * 60 * 60 * 1000, fetch: fetchMock as unknown as typeof fetch });
    expect(calls).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("reads nothing without a key", async () => {
    const { fetchMock } = api();
    expect(await loadOddsApi({ key: "", cacheFile: cacheFile(), fetch: fetchMock as unknown as typeof fetch })).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
