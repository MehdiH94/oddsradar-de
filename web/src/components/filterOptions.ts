import type { EventSort } from "../api";

// The filters' choices, shared by the desktop's menus (SortMenu, MarketsMenu)
// and the phone's sheet (FilterSheet).

export const SORT_LABELS: Record<EventSort, string> = {
  trj: "Best payout",
  start: "Kick-off time",
  value: "Best value",
};

export const MARKETS_OPTIONS: ReadonlyArray<{ value: boolean; label: string; summary: string }> = [
  { value: false, label: "All matches", summary: "All" },
  { value: true, label: "With player markets", summary: "Players" },
];

// The competition filter's first choice, which keeps them all (CompetitionMenu,
// FilterSheet).
export const ALL_COMPETITIONS_LABEL = "All competitions";
