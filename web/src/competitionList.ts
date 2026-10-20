import { favoriteRank, normalizeCompetition } from "./favoriteCompetitions";

// How many competitions besides the favorites the menu shows while folded:
// enough to tell that the list goes on.
export const FOLDED_OTHERS = 3;
// A list that would hide fewer than this is shown whole: a button to unfold two
// lines is not worth it.
const MIN_HIDDEN = 2;

export interface CompetitionList {
  // The favorites, in their usual order, then the others, alphabetical.
  favorites: string[];
  others: string[];
  // Every competition, searched or not: the unfold button's count.
  total: number;
  // Whether there is a fold to undo, and so a button for it.
  foldable: boolean;
  // A search is on: whatever matches is shown, folded or not.
  searching: boolean;
}

const alphabetical = (a: string, b: string) => a.localeCompare(b, "de");

// The competitions of a sport as the menu lists them. The one chosen is listed
// even when the sport has none of it left (an address naming it), so that it
// can be undone, and stays in sight when the list is folded.
export function competitionList({
  sport,
  competitions,
  current,
  query,
  expanded,
}: {
  sport: string;
  competitions: readonly string[];
  current: string;
  query: string;
  expanded: boolean;
}): CompetitionList {
  const names = current && !competitions.includes(current) ? [...competitions, current] : [...competitions];
  const needle = normalizeCompetition(query);
  const searching = needle !== "";
  const matching = searching ? names.filter((name) => normalizeCompetition(name).includes(needle)) : names;

  const ranks = new Map(matching.map((name) => [name, favoriteRank(sport, name)]));
  const favorites = matching
    .filter((name) => ranks.get(name) !== null)
    .sort((a, b) => ranks.get(a)! - ranks.get(b)! || alphabetical(a, b));
  const others = matching.filter((name) => ranks.get(name) === null).sort(alphabetical);

  const foldable = !searching && others.length - FOLDED_OTHERS >= MIN_HIDDEN;
  const shownOthers =
    foldable && !expanded ? others.filter((name, index) => index < FOLDED_OTHERS || name === current) : others;
  return { favorites, others: shownOthers, total: names.length, foldable, searching };
}
