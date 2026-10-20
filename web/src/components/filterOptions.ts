import type { EventSort } from "../api";

// The filters' choices, shared by the desktop's menus (SortMenu, MarketsMenu)
// and the phone's sheet (FilterSheet).

export const SORT_LABELS: Record<EventSort, string> = {
  trj: "Beste Auszahlungsquote",
  start: "Anstoßzeit",
  value: "Bester Value",
};

export const MARKETS_OPTIONS: ReadonlyArray<{ value: boolean; label: string; summary: string }> = [
  { value: false, label: "Alle Spiele", summary: "Alle" },
  { value: true, label: "Mit Spielermärkten", summary: "Spieler" },
];

// The competition filter's first choice, which keeps them all (CompetitionMenu,
// FilterSheet).
export const ALL_COMPETITIONS_LABEL = "Alle Wettbewerbe";
