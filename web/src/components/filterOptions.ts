import type { EventSort } from "../api";

// The filters' choices, shared by the desktop's menus (SortMenu, MarketsMenu)
// and the phone's sheet (FilterSheet).

export const SORT_LABELS: Record<EventSort, string> = {
  trj: "Meilleur TRJ",
  start: "Date de début",
  value: "Meilleure value",
};

export const MARKETS_OPTIONS: ReadonlyArray<{ value: boolean; label: string; summary: string }> = [
  { value: false, label: "Tous les matchs", summary: "Tous" },
  { value: true, label: "Avec marchés joueurs", summary: "Joueurs" },
];

// The competition filter's first choice, which keeps them all (CompetitionMenu,
// FilterSheet).
export const ALL_COMPETITIONS_LABEL = "Toutes les compétitions";
