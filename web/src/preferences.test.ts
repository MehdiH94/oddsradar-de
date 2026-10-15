import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPreferences, mergeInitialFilters, readPreferences, savePreferences, type Preferences } from "./preferences";
import { DEFAULT_BOOKMAKERS } from "./bookmakers";

const PREFS: Preferences = {
  sport: "tennis",
  sort: "start",
  bookmakers: ["winamax", "vbet"],
  players: true,
  favoriteSports: ["tennis"],
};

const reply = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("readPreferences", () => {
  it("takes what the server sends", () => {
    expect(readPreferences({ preferences: PREFS })).toEqual(PREFS);
  });

  it.each([
    ["nothing saved yet", { preferences: null }],
    ["another answer", { events: [], total: 0 }],
    ["a body that is not an object", "oops"],
    ["a wrong sort", { preferences: { ...PREFS, sort: "random" } }],
    ["bookmakers that are not a list", { preferences: { ...PREFS, bookmakers: "winamax" } }],
    ["players that is not a boolean", { preferences: { ...PREFS, players: 1 } }],
    ["favorites that are not names", { preferences: { ...PREFS, favoriteSports: [3] } }],
  ])("reads %s as no preferences", (_label, body) => {
    expect(readPreferences(body)).toBeNull();
  });
});

describe("mergeInitialFilters", () => {
  it("is the URL's filters when nothing is saved", () => {
    expect(mergeInitialFilters("?sport=golf&q=masters", null)).toMatchObject({ sport: "golf", q: "masters" });
  });

  it("applies the saved filters to a bare address", () => {
    expect(mergeInitialFilters("", PREFS)).toEqual({
      sport: "tennis",
      sort: "start",
      q: "",
      bookmakers: ["winamax", "vbet"],
      players: true,
      page: 1,
    });
  });

  it("applies them whatever the other keys: the search, the page, the match are the tab's own", () => {
    expect(mergeInitialFilters("?q=nadal&page=3&match=abc", PREFS)).toMatchObject({
      sport: "tennis",
      bookmakers: ["winamax", "vbet"],
      q: "nadal",
      page: 3,
      match: "abc",
    });
  });

  it.each(["?sport=golf", "?sort=value", "?bookmakers=betclic", "?players=1"])(
    "leaves the address alone when it has a filter of its own (%s)",
    (search) => {
      const merged = mergeInitialFilters(search, PREFS);
      expect(merged).not.toMatchObject({ sport: "tennis", sort: "start", bookmakers: ["winamax", "vbet"] });
    },
  );

  it("keeps a link's defaults for what the link doesn't say, not the saved ones", () => {
    const merged = mergeInitialFilters("?sport=value-bets&sort=value", PREFS);
    expect(merged).toMatchObject({ sport: "value-bets", sort: "value", bookmakers: [...DEFAULT_BOOKMAKERS] });
    expect(merged.players).toBeUndefined();
  });

  it("applies saved filters with no bookmaker at all: none is not the defaults", () => {
    expect(mergeInitialFilters("", { ...PREFS, bookmakers: [] }).bookmakers).toEqual([]);
  });
});

describe("savePreferences", () => {
  it("sends them as JSON, which the server requires of a write", async () => {
    const fetchMock = vi.fn(() => reply(null, 204));
    vi.stubGlobal("fetch", fetchMock);

    await expect(savePreferences(PREFS)).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith("/api/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(PREFS),
    });
  });

  it("says it failed rather than throwing, on a refusal or a network error", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reply({ error: "invalid" }, 400)));
    await expect(savePreferences(PREFS)).resolves.toBe(false);

    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("offline"))));
    await expect(savePreferences(PREFS)).resolves.toBe(false);
  });

  it("tells the session ended on a 401", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reply({ error: "unauthenticated" }, 401)));
    const heard = vi.fn();
    window.addEventListener("coteradar:unauthorized", heard);

    await expect(savePreferences(PREFS)).resolves.toBe(false);

    window.removeEventListener("coteradar:unauthorized", heard);
    expect(heard).toHaveBeenCalledOnce();
  });
});

describe("loadPreferences", () => {
  it("is what the server has saved", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reply({ preferences: PREFS })));
    await expect(loadPreferences()).resolves.toEqual(PREFS);
  });

  it("is null, never an error, when the server can't say", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reply({ error: "boom" }, 500)));
    await expect(loadPreferences()).resolves.toBeNull();

    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("offline"))));
    await expect(loadPreferences()).resolves.toBeNull();
  });

  it("gives up after its delay, so the dashboard never waits on it", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    const loading = loadPreferences(3000);
    await vi.advanceTimersByTimeAsync(3000);

    await expect(loading).resolves.toBeNull();
  });
});
