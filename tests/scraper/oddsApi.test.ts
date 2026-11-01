import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOddsApi, nextRenewal, ODDS_API_COMPETITIONS, OddsApiCache, OddsApiEvent, pacedRefreshMs, parseOddsApiEvents } from "../../src/scraper/oddsApi";

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

// An API whose event list has a match tomorrow for the Bundesliga only; its
// sports list (free) tells the credits left, as `sportsRemaining`. Its odds
// leave 5000 credits by default, enough for no pacing.
function api(opts: { remaining?: string; sportsRemaining?: string; noHeader?: boolean } = {}) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: URL | string) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname.endsWith("/sports")) {
      return new Response("[]", { status: 200, headers: opts.sportsRemaining ? { "x-requests-remaining": opts.sportsRemaining } : {} });
    }
    const sport = url.pathname.split("/")[3];
    if (url.pathname.endsWith("/events")) {
      const events = sport === "soccer_germany_bundesliga" ? [{ commence_time: "2026-10-18T13:30:00Z" }] : [];
      return new Response(JSON.stringify(events), { status: 200 });
    }
    return new Response(JSON.stringify(BUNDESLIGA), { status: 200, headers: opts.noHeader ? {} : { "x-requests-remaining": opts.remaining ?? "5000" } });
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

    // Ten minutes later, from the file: no request.
    calls.length = 0;
    const later = await loadOddsApi({ key: "k", cacheFile: file, now: () => NOW + 10 * 60 * 1000, fetch: fetchMock as unknown as typeof fetch });
    expect(calls).toEqual([]);
    expect(later).toHaveLength(6);

    // Past the refresh time (15 minutes): read again.
    await loadOddsApi({ key: "k", cacheFile: file, now: () => NOW + 16 * 60 * 1000, fetch: fetchMock as unknown as typeof fetch });
    expect(calls.filter((p) => p.endsWith("/odds"))).toHaveLength(1);
  });

  it("asks for Pinnacle's prices with Tipico's and Winamax's, in the same request", async () => {
    const asked: URL[] = [];
    const { fetchMock } = api();
    const spy = vi.fn(async (input: URL | string) => {
      asked.push(new URL(String(input)));
      return fetchMock(input);
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    await loadOddsApi({ key: "k", cacheFile: cacheFile(), now: () => NOW, fetch: spy as unknown as typeof fetch });
    const odds = asked.filter((u) => u.pathname.endsWith("/odds"));
    expect(odds).toHaveLength(1);
    expect(odds[0].searchParams.get("bookmakers")).toBe("tipico_de,winamax_de,pinnacle");
  });

  it("drops the matches that have started from the prices it keeps", async () => {
    const { fetchMock } = api();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const events = await loadOddsApi({ key: "k", cacheFile: cacheFile(), now: () => Date.parse("2026-10-17T14:00:00Z"), fetch: fetchMock as unknown as typeof fetch });
    expect(events.every((e) => Date.parse(e.commence_time!) > Date.parse("2026-10-17T14:00:00Z"))).toBe(true);
    expect(events.length).toBeLessThan(6);
  });

  it("stops reading when the month's last credits are left, and then shows no old prices", async () => {
    const file = cacheFile();
    const { fetchMock, calls } = api({ remaining: "10" });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await loadOddsApi({ key: "k", cacheFile: file, now: () => NOW, fetch: fetchMock as unknown as typeof fetch });
    calls.length = 0;
    const stale = await loadOddsApi({ key: "k", cacheFile: file, now: () => NOW + 31 * 60 * 1000, fetch: fetchMock as unknown as typeof fetch });
    expect(calls).toEqual([]);
    expect(warn).toHaveBeenCalled();
    // Not read again for over half an hour: its prices are no longer shown.
    expect(stale).toEqual([]);
  });

  it("asks for the credits again, for free, every 6 hours once spent, and reads again when they renewed", async () => {
    const file = cacheFile();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const spent = api({ remaining: "10", sportsRemaining: "10" });
    await loadOddsApi({ key: "k", cacheFile: file, now: () => NOW, fetch: spent.fetchMock as unknown as typeof fetch });

    // Within the 6 hours: nothing asked at all.
    spent.calls.length = 0;
    await loadOddsApi({ key: "k", cacheFile: file, now: () => NOW + 60 * 60 * 1000, fetch: spent.fetchMock as unknown as typeof fetch });
    expect(spent.calls).toEqual([]);

    // After them, still spent: the free sports list only, no odds bought.
    await loadOddsApi({ key: "k", cacheFile: file, now: () => NOW + 7 * 60 * 60 * 1000, fetch: spent.fetchMock as unknown as typeof fetch });
    expect(spent.calls).toEqual(["/v4/sports"]);

    // The month's credits renewed: the next ask finds them, and the prices are read again.
    const renewed = api({ remaining: "499", sportsRemaining: "500" });
    await loadOddsApi({ key: "k", cacheFile: file, now: () => NOW + 14 * 60 * 60 * 1000, fetch: renewed.fetchMock as unknown as typeof fetch });
    expect(renewed.calls[0]).toBe("/v4/sports");
    expect(renewed.calls).toContain("/v4/sports/soccer_germany_bundesliga/odds");
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ creditsLeft: 499 });
  });

  it("takes no credits header as no count, not as none left", async () => {
    const file = cacheFile();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { fetchMock } = api({ noHeader: true });
    await loadOddsApi({ key: "k", cacheFile: file, now: () => NOW, fetch: fetchMock as unknown as typeof fetch });
    expect(JSON.parse(readFileSync(file, "utf8")).creditsLeft).toBeUndefined();
  });

  it("paces its reads to last until the credits renew, never showing an old price meanwhile", async () => {
    const file = cacheFile();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    // 460 above the floor, one competition a round, 14.5 days to the 1st: a read every 45 min.
    const { fetchMock, calls } = api({ remaining: "480" });
    await loadOddsApi({ key: "k", cacheFile: file, now: () => NOW, fetch: fetchMock as unknown as typeof fetch });
    calls.length = 0;
    await loadOddsApi({ key: "k", cacheFile: file, now: () => NOW + 16 * 60 * 1000, fetch: fetchMock as unknown as typeof fetch });
    expect(calls).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/paced to last the month: a read every 45 min \(480 credits left\)/));
    expect(JSON.parse(readFileSync(file, "utf8")).refreshMinutes).toBe(45);
    // Past the half hour: its prices no longer shown, though not read again yet.
    expect(await loadOddsApi({ key: "k", cacheFile: file, now: () => NOW + 40 * 60 * 1000, fetch: fetchMock as unknown as typeof fetch })).toEqual([]);
    await loadOddsApi({ key: "k", cacheFile: file, now: () => NOW + 47 * 60 * 1000, fetch: fetchMock as unknown as typeof fetch });
    expect(calls.filter((p) => p.endsWith("/odds"))).toHaveLength(1);
  });

  it("reads nothing without a key", async () => {
    const { fetchMock } = api();
    expect(await loadOddsApi({ key: "", cacheFile: cacheFile(), fetch: fetchMock as unknown as typeof fetch })).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("pacedRefreshMs", () => {
  const MIN = 60 * 1000;
  const cache = (creditsLeft: number | undefined, withEvents: number): OddsApiCache => ({
    competitions: Object.fromEntries(Object.keys(ODDS_API_COMPETITIONS).map((k, i) => [k, { readAt: "2026-11-01T10:00:00Z", events: i < withEvents ? BUNDESLIGA : [] }])),
    creditsLeft,
  });
  const at = Date.parse("2026-11-01T10:00:00Z");

  it("renews on the 1st of next month, UTC", () => {
    expect(new Date(nextRenewal(at)).toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(new Date(nextRenewal(Date.parse("2026-12-31T23:00:00Z"))).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("spreads the credits above the floor over the rounds left, a credit a competition with matches", () => {
    // 356 left, 336 spendable, 6 competitions a round: 56 rounds over 29 days 14 hours.
    const paced = pacedRefreshMs(cache(356, 6), 15 * MIN, at);
    expect(Math.round(paced / MIN)).toBe(Math.round((nextRenewal(at) - at) / 56 / MIN));
    expect(paced).toBeGreaterThan(12 * 60 * MIN);
  });

  it("never reads more often than the refresh time set, nor paces without a count or under the floor", () => {
    expect(pacedRefreshMs(cache(100_000, 6), 15 * MIN, at)).toBe(15 * MIN);
    expect(pacedRefreshMs(cache(undefined, 6), 15 * MIN, at)).toBe(15 * MIN);
    expect(pacedRefreshMs(cache(20, 6), 15 * MIN, at)).toBe(15 * MIN);
    // No competition with matches yet: counted as one.
    expect(pacedRefreshMs(cache(356, 0), 15 * MIN, at)).toBe(Math.ceil((nextRenewal(at) - at) / 336));
  });
});
