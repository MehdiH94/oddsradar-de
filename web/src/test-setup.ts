import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";

// The favorite sports live in localStorage: don't let one test's leak into the
// next.
afterEach(() => localStorage.clear());

// OddsRadar reads one bookmaker for now (LeoVegas.de). The tests compare two,
// which the filter, the best prices, the surebets and the freebets need: they
// know a second one, Winamax.
vi.mock("./bookmakers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./bookmakers")>();
  const ALL_BOOKMAKERS = ["leovegas", "winamax"] as const;
  const DEFAULT_BOOKMAKERS: readonly string[] = ALL_BOOKMAKERS;
  return {
    ...actual,
    ALL_BOOKMAKERS,
    DEFAULT_BOOKMAKERS,
    isDefaultBookmakers: (selected: readonly string[]) =>
      selected.length === DEFAULT_BOOKMAKERS.length && selected.every((b, i) => b === DEFAULT_BOOKMAKERS[i]),
    BOOKMAKER_BRANDING: { ...actual.BOOKMAKER_BRANDING, winamax: { name: "Winamax", logo: "/winamax.png" } },
    ALL_BOOKMAKER_NAMES: ["LeoVegas", "Winamax"],
    ALL_BOOKMAKERS_SENTENCE: "LeoVegas and Winamax",
  };
});
