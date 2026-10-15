import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchEvents, fetchEventSuggestions, fetchFirstEvents, fetchSports, fetchValueBets } from "./api";

describe("fetchEvents", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests /api/events with sport and page as query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ events: [], total: 0, page: 2, pageSize: 20 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchEvents({ sport: "tennis", page: 2 });

    expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=tennis&page=2");
    expect(result).toEqual({ events: [], total: 0, page: 2, pageSize: 20 });
  });

  it("asks for every value bet, with the search, the order and the ticked bookmakers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ bets: [], total: 0 }) });
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchValueBets()).toEqual({ bets: [], total: 0 });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/value-bets");
    await fetchValueBets({ q: "psg", sort: "start", bookmakers: [] });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/value-bets?q=psg&sort=start&bookmakers=");
  });

  it("requests /api/events with no query params when called with no options", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ events: [], total: 0, page: 1, pageSize: 20 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchEvents();

    expect(fetchMock).toHaveBeenCalledWith("/api/events");
  });

  it("passes the search text as q, URL-encoded", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ events: [], total: 0, page: 1, pageSize: 20 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchEvents({ q: "PSG - OM", page: 1 });

    expect(fetchMock).toHaveBeenCalledWith("/api/events?q=PSG+-+OM&page=1");
  });

  it("passes the sort and the bookmakers counted in each TRJ, even when there are none", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ events: [], total: 0, page: 1, pageSize: 20 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchEvents({ sport: "football", sort: "trj", bookmakers: ["leovegas"], page: 1 });
    expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=football&sort=trj&bookmakers=leovegas&page=1");

    await fetchEvents({ sort: "start", bookmakers: [], page: 1 });
    expect(fetchMock).toHaveBeenCalledWith("/api/events?sort=start&bookmakers=&page=1");
  });
});

describe("fetchEventSuggestions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests suggestions for the query, scoped to the sport when one is selected", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(["PSG - OM"]) });
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchEventSuggestions({ q: "psg" })).toEqual(["PSG - OM"]);
    expect(fetchMock).toHaveBeenCalledWith("/api/events/suggestions?q=psg");

    await fetchEventSuggestions({ q: "psg", sport: "football" });
    expect(fetchMock).toHaveBeenCalledWith("/api/events/suggestions?q=psg&sport=football");
  });
});

describe("fetchSports", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests /api/sports and returns the sport list", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(["football", "tennis"]) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSports();

    expect(fetchMock).toHaveBeenCalledWith("/api/sports");
    expect(result).toEqual(["football", "tennis"]);
  });
});

describe("fetchFirstEvents", () => {
  afterEach(() => vi.unstubAllGlobals());

  const page = (ids: string[], total = 300) => ({
    ok: true,
    json: () => Promise.resolve({ events: ids.map((id) => ({ id })), total, page: 1, pageSize: 20 }),
  });

  it("asks for the first `count` matches in one request up to 100", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(page(["a", "b"])));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchFirstEvents({ sport: "football", count: 40 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/events?sport=football&page=1&pageSize=40");
    expect(result).toMatchObject({ total: 300, page: 1, pageSize: 40 });
  });

  it("beyond 100, pages of 100 then of 20 whose offsets line up, without a match twice", async () => {
    const fetchMock = vi.fn((url: string) => {
      const params = new URLSearchParams(url.split("?")[1]);
      return Promise.resolve(page([`${params.get("page")}/${params.get("pageSize")}`, "same"]));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchFirstEvents({ sport: "football", count: 140 });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/events?sport=football&page=1&pageSize=100",
      "/api/events?sport=football&page=6&pageSize=20",
      "/api/events?sport=football&page=7&pageSize=20",
    ]);
    expect(result.events.map((event) => event.id)).toEqual(["1/100", "same", "6/20", "7/20"]);
    expect(result.pageSize).toBe(140);
  });
});
