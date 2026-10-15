import { afterEach, describe, expect, it, vi } from "vitest";
import { currentPath, isDashboardQuery, matchHref, navigate, ODDS_PATH, onPathChange, valueBetsHref } from "./routes";

describe("isDashboardQuery", () => {
  it("is true for any key the dashboard keeps in its address", () => {
    for (const search of ["?sport=tennis", "?match=abc", "?q=psg", "?sort=value", "?bookmakers=winamax", "?page=2", "?players=1", "?competition=Ligue+1"]) {
      expect(isDashboardQuery(search), search).toBe(true);
    }
  });

  it("is false for no query and for a query the dashboard does not know", () => {
    expect(isDashboardQuery("")).toBe(false);
    expect(isDashboardQuery("?utm_source=newsletter&utm_campaign=x")).toBe(false);
  });
});

describe("links into the dashboard", () => {
  it("leads to the value bets' list, biggest edge first, with the default bookmakers", () => {
    expect(valueBetsHref).toBe("/cotes?sport=value-bets&sort=value");
  });

  it("opens a match from the value bets' list, so that its back link returns there", () => {
    expect(matchHref("psg-om")).toBe("/cotes?sport=value-bets&sort=value&match=psg-om");
  });
});

describe("currentPath", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("is the home at / without a query, and with one the dashboard does not know", () => {
    window.history.replaceState(null, "", "/");
    expect(currentPath()).toBe("/");
    window.history.replaceState(null, "", "/?utm_source=newsletter");
    expect(currentPath()).toBe("/");
    expect(window.location.search).toBe("?utm_source=newsletter");
  });

  it("is the dashboard at /cotes, with or without a trailing slash", () => {
    window.history.replaceState(null, "", "/cotes?sport=tennis");
    expect(currentPath()).toBe(ODDS_PATH);
    window.history.replaceState(null, "", "/cotes/");
    expect(currentPath()).toBe(ODDS_PATH);
  });

  it("sends an old dashboard link at / to /cotes, keeping every filter, the match and the hash", () => {
    window.history.replaceState(null, "", "/?sport=tennis&match=abc&bookmakers=winamax%2Cbetclic#top");
    expect(currentPath()).toBe(ODDS_PATH);
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      "/cotes?sport=tennis&match=abc&bookmakers=winamax%2Cbetclic#top"
    );
  });

  it("replaces the old entry rather than adding one, so that Back does not return to the redirect", () => {
    const length = window.history.length;
    window.history.replaceState(null, "", "/?sport=football");
    currentPath();
    expect(window.history.length).toBe(length);
  });
});

describe("navigate", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("pushes a history entry and tells the listeners, until they stop", () => {
    const listener = vi.fn();
    const stop = onPathChange(listener);
    navigate("/cotes?sport=value-bets");
    expect(window.location.pathname + window.location.search).toBe("/cotes?sport=value-bets");
    expect(listener).toHaveBeenCalledTimes(1);

    stop();
    navigate("/");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("tells the listeners of the browser's Back and Forward too", () => {
    const listener = vi.fn();
    const stop = onPathChange(listener);
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe("safeNext", () => {
  it("keeps a path of this site, with its query", async () => {
    const { safeNext } = await import("./routes");
    expect(safeNext("?next=%2Fcotes%3Fsport%3Dtennis")).toBe("/cotes?sport=tennis");
  });

  it("refuses anything that would leave the site or loop on the account pages", async () => {
    const { safeNext } = await import("./routes");
    for (const next of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "cotes", "/connexion", "/inscription?x=1"]) {
      expect(safeNext(`?next=${encodeURIComponent(next)}`)).toBeNull();
    }
    expect(safeNext("")).toBeNull();
  });
});
