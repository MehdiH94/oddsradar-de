import { useSyncExternalStore } from "react";

// Whether a media query matches, followed live (a phone turned sideways, a
// window resized). Read at once on the first render: no flash of the other
// layout. Where there is no matchMedia (jsdom, in the tests), `fallback`.
export function useMediaQuery(query: string, fallback: boolean): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = typeof window.matchMedia === "function" ? window.matchMedia(query) : null;
      list?.addEventListener?.("change", onChange);
      return () => list?.removeEventListener?.("change", onChange);
    },
    () => (typeof window.matchMedia === "function" ? window.matchMedia(query).matches : fallback),
    () => fallback
  );
}

// The site is designed for a phone first (README, "Usage principal : le
// mobile"); from this width up, the desktop's layout: the filters in a bar
// instead of a sheet, every bookmaker's price in sight, numbered pages.
export const WIDE_QUERY = "(min-width: 768px)";

// The tests render the desktop's layout unless they stub matchMedia (see
// mockPhone in testUtils.ts).
export const useIsWide = () => useMediaQuery(WIDE_QUERY, true);

// From this width up, the matches' list is a table with every bookmaker's
// price in sight (OddsTable); under it, cards (two columns from 768 px).
export const TABLE_QUERY = "(min-width: 1024px)";
export const useIsTable = () => useMediaQuery(TABLE_QUERY, true);
