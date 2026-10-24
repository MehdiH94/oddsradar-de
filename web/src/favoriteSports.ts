import { useCallback, useEffect, useState } from "react";

export const MAX_FAVORITES = 3;

// Kept with the account (web/src/preferences.ts), not in the URL: a link
// someone shares (or an alert's) shouldn't carry the sender's favorites. This
// browser keeps a copy too, for when the server doesn't answer.
const STORAGE_KEY = "oddsblitzer.favoriteSports";
// The key the site kept them under while it was CoteRadar: read once when the
// new one is empty, then moved, so that a tester keeps their favorites.
const LEGACY_STORAGE_KEY = "coteradar.favoriteSports";

// The favorites first, in the order they were starred, then the other sports
// as they came. A favorite with no odds today has no chip to show.
export function orderSports(sports: readonly string[], favorites: readonly string[]): string[] {
  const shown = favorites.filter((sport) => sports.includes(sport));
  return [...shown, ...sports.filter((sport) => !shown.includes(sport))];
}

// A favorite with no odds today (golf between two tournaments) is kept for when
// it is back, but its chip can't be unstarred: it must not hold a place.
export function canAddFavorite(favorites: readonly string[], available: readonly string[]): boolean {
  return favorites.length < MAX_FAVORITES || favorites.some((sport) => !available.includes(sport));
}

// Stars a sport, or unstars it. At the limit, the oldest favorite that has no
// odds today makes room; with none to drop, the list stays as it is.
export function toggleFavorite(favorites: readonly string[], sport: string, available: readonly string[]): string[] {
  if (favorites.includes(sport)) return favorites.filter((favorite) => favorite !== sport);
  if (favorites.length < MAX_FAVORITES) return [...favorites, sport];
  const dropped = favorites.find((favorite) => !available.includes(favorite));
  if (dropped === undefined) return [...favorites];
  return [...favorites.filter((favorite) => favorite !== dropped), sport];
}

// A browser can refuse its storage (a private window, blocked site data): the
// favorites then last as long as the page does.
export function loadFavorites(): string[] {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (raw !== null) {
        localStorage.setItem(STORAGE_KEY, raw);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
    }
    const stored: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(stored)) return [];
    const names = stored.filter((sport): sport is string => typeof sport === "string");
    return [...new Set(names)].slice(0, MAX_FAVORITES);
  } catch {
    return [];
  }
}

export function saveFavorites(favorites: readonly string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
  } catch {
    // Nothing to do: see loadFavorites.
  }
}

// `available` is the sports with odds right now (the chips there are).
// `saved` is the account's favorites, when the server has some: they come
// before this browser's, which stay written as a copy.
export function useFavoriteSports(available: readonly string[], saved?: readonly string[]) {
  const [favorites, setFavorites] = useState(() => (saved ? [...saved] : loadFavorites()));

  useEffect(() => saveFavorites(favorites), [favorites]);

  const toggle = useCallback(
    (sport: string) => setFavorites((current) => toggleFavorite(current, sport, available)),
    [available],
  );

  return { favorites, toggle, canAdd: canAddFavorite(favorites, available) };
}
