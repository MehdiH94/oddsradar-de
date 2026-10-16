import { describe, expect, it } from "vitest";
import { conversionsUrl } from "./freebetsApi";
import { DEFAULT_SETTINGS, readSettings, requestOf, settingsQuery, type Settings } from "./settings";

describe("the settings in the address", () => {
  it("opens on the defaults when the address says nothing, or nonsense", () => {
    expect(readSettings("")).toEqual(DEFAULT_SETTINGS);
    expect(readSettings("?mode=other&legs=9&bookmaker=nobody")).toEqual(DEFAULT_SETTINGS);
  });

  it("reads every setting", () => {
    expect(readSettings("?mode=exchange&bookmaker=merkurbets&sports=football,tennis")).toEqual({ mode: "exchange", legs: 1, bookmaker: "merkurbets", sports: ["football", "tennis"] });
    expect(readSettings("?legs=3")).toMatchObject({ mode: "bookmakers", legs: 3 });
    // Present and empty: no sport at all.
    expect(readSettings("?sports=").sports).toEqual([]);
  });

  it("writes only what differs from the defaults", () => {
    expect(settingsQuery(DEFAULT_SETTINGS)).toBe("");
    expect(settingsQuery({ ...DEFAULT_SETTINGS, legs: 2 })).toBe("legs=2");
    expect(settingsQuery({ mode: "exchange", legs: 3, bookmaker: "merkurbets", sports: ["football"] })).toBe("mode=exchange&bookmaker=merkurbets&sports=football");
    expect(settingsQuery({ ...DEFAULT_SETTINGS, sports: [] })).toBe("sports=");
  });

  it("gives back what it wrote", () => {
    const settings: Settings[] = [
      DEFAULT_SETTINGS,
      { mode: "bookmakers", legs: 3, bookmaker: null, sports: ["tennis"] },
      { mode: "exchange", legs: 1, bookmaker: "leovegas", sports: [] },
    ];
    for (const s of settings) expect(readSettings(settingsQuery(s))).toEqual(s);
  });
});

describe("requestOf", () => {
  it("asks for the format between bookmakers, with the sports when some are ticked", () => {
    expect(requestOf({ ...DEFAULT_SETTINGS, legs: 2 }, [])).toEqual({ mode: "bookmakers", legs: 2 });
    expect(requestOf({ ...DEFAULT_SETTINGS, sports: ["tennis"] }, [])).toEqual({ mode: "bookmakers", legs: 1, sports: ["tennis"] });
  });

  it("asks for the chosen bookmaker against the exchange, else the first one that holds freebets, else nothing", () => {
    const exchange: Settings = { mode: "exchange", legs: 1, bookmaker: "merkurbets", sports: null };
    expect(requestOf(exchange, ["leovegas", "merkurbets"])).toEqual({ mode: "exchange", bookmaker: "merkurbets" });
    expect(requestOf(exchange, ["leovegas"])).toEqual({ mode: "exchange", bookmaker: "leovegas" });
    expect(requestOf({ ...exchange, bookmaker: null }, ["merkurbets", "leovegas"])).toEqual({ mode: "exchange", bookmaker: "merkurbets" });
    expect(requestOf(exchange, [])).toBeNull();
  });
});

describe("conversionsUrl", () => {
  it("is the route's address for each request", () => {
    expect(conversionsUrl({ mode: "bookmakers", legs: 2 })).toBe("/api/freebets/conversions?mode=bookmakers&legs=2");
    expect(conversionsUrl({ mode: "exchange", bookmaker: "merkurbets", sports: ["football", "tennis"] })).toBe(
      "/api/freebets/conversions?mode=exchange&bookmaker=merkurbets&sports=football%2Ctennis"
    );
    expect(conversionsUrl({ mode: "bookmakers", legs: 1, sports: [] })).toBe("/api/freebets/conversions?mode=bookmakers&legs=1&sports=");
  });
});
