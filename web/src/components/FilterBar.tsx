import { RotateCcw } from "lucide-react";
import type { EventSort } from "../api";
import { SportTabs } from "./SportTabs";
import { SearchBox } from "./SearchBox";
import { SortMenu } from "./SortMenu";
import { BookmakerMenu } from "./BookmakerMenu";
import { MarketsMenu } from "./MarketsMenu";
import { CompetitionMenu } from "./CompetitionMenu";
import styles from "./FilterBar.module.css";

// The filters in sight. On a phone, only the two used all the time: the
// sports, in a row stuck to the top of the screen, and the search; the others
// are in the "Filtres" sheet (FilterSheet), opened from the bottom bar. From
// 768 px (`wide`), the whole bar sticks, the sort, the bookmakers and, for the
// sports with players' markets, the markets as menus after the search. The
// value bets' list has no sports (`sports` left out): they are every sport's.
// The matches' list has a competitions menu (`competitions`) too, before them.
export function FilterBar({
  wide = true,
  sports,
  favoriteSports,
  onToggleFavoriteSport,
  canAddFavoriteSport,
  sport,
  onSportChange,
  search,
  suggestions,
  onSearchChange,
  sort,
  sortOrders,
  onSortChange,
  bookmakers,
  onBookmakersChange,
  players = false,
  onPlayersChange,
  competition = "",
  competitions,
  onCompetitionChange,
  onReset,
}: {
  wide?: boolean;
  sports?: readonly string[];
  // The sports starred (SportTabs), which lead the row; each sport has a star
  // with `onToggleFavoriteSport` (from 768 px: on a phone, in the sheet).
  favoriteSports?: readonly string[];
  onToggleFavoriteSport?: (sport: string) => void;
  canAddFavoriteSport?: boolean;
  sport: string;
  onSportChange: (sport: string) => void;
  search: string;
  suggestions: readonly string[];
  onSearchChange: (search: string) => void;
  sort: EventSort;
  // The orders the sort menu offers (SortMenu).
  sortOrders?: readonly EventSort[];
  onSortChange: (sort: EventSort) => void;
  bookmakers: readonly string[];
  onBookmakersChange: (bookmakers: string[]) => void;
  players?: boolean;
  // The markets menu shows only with it: for the sports with players' markets.
  onPlayersChange?: (players: boolean) => void;
  // The competitions menu shows only with them: in the matches' list.
  competition?: string;
  competitions?: readonly string[];
  onCompetitionChange?: (competition: string) => void;
  // Shown only when some filter differs from its default.
  onReset?: () => void;
}) {
  return (
    <div className={styles.bar} role="search" aria-label="Filters">
      {sports && (
        <div className={styles.sports}>
          <div className={styles.inner}>
            <SportTabs
              sports={sports}
              value={sport}
              onChange={onSportChange}
              favorites={favoriteSports}
              onToggleFavorite={wide ? onToggleFavoriteSport : undefined}
              canAddFavorite={canAddFavoriteSport}
            />
          </div>
        </div>
      )}
      <div className={styles.controls}>
        <div className={styles.inner}>
          <SearchBox value={search} suggestions={suggestions} onChange={onSearchChange} />
          {wide && (
            <>
              {competitions && onCompetitionChange && (
                <CompetitionMenu sport={sport} value={competition} competitions={competitions} onChange={onCompetitionChange} />
              )}
              <SortMenu value={sort} onChange={onSortChange} orders={sortOrders} />
              <BookmakerMenu selected={bookmakers} onChange={onBookmakersChange} />
              {onPlayersChange && <MarketsMenu players={players} onChange={onPlayersChange} />}
              {onReset && (
                <button type="button" className={styles.reset} onClick={onReset}>
                  <RotateCcw size={14} aria-hidden="true" />
                  Reset the filters
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
