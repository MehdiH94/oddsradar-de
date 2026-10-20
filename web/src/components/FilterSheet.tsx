import type { ReactNode } from "react";
import { RotateCcw, Star } from "lucide-react";
import type { EventSort } from "../api";
import { ALL_BOOKMAKERS, BOOKMAKER_BRANDING } from "../bookmakers";
import { BookmakerLogo } from "../BookmakerLogo";
import { MAX_FAVORITES } from "../favoriteSports";
import { sportEmoji, sportLabel } from "../sports";
import { MARKETS_OPTIONS, SORT_LABELS } from "./filterOptions";
import { CompetitionPicker } from "./CompetitionPicker";
import { Sheet } from "./Sheet";
import styles from "./FilterSheet.module.css";

const bookmakerName = (bookmaker: string) => BOOKMAKER_BRANDING[bookmaker]?.name ?? bookmaker;

function Group({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.options}>{children}</div>
    </fieldset>
  );
}

function Option({
  type,
  name,
  checked,
  onChange,
  children,
}: {
  type: "radio" | "checkbox";
  name?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className={styles.option}>
      <span className={styles.optionText}>{children}</span>
      <input
        type={type}
        name={name}
        className={type === "radio" ? styles.radio : styles.checkbox}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

// The phone's filters, in a sheet (Sheet) opened from the bottom bar's
// "Filtres": the sort, the competition, the bookmakers compared, the markets and the favorite
// sports, each choice a whole row to tap. Every change applies at once, the
// list behind follows; the button at the bottom closes the sheet on the
// results. The desktop's are menus in the filter bar (FilterBar).
export function FilterSheet({
  id,
  open,
  onClose,
  resultsLabel,
  sort,
  sortOrders,
  onSortChange,
  bookmakers,
  onBookmakersChange,
  players = false,
  onPlayersChange,
  sport,
  competition = "",
  competitions,
  onCompetitionChange,
  sports,
  favoriteSports,
  onToggleFavoriteSport,
  canAddFavoriteSport = true,
  onReset,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  // "Show the 412 results".
  resultsLabel: string;
  sort: EventSort;
  sortOrders: readonly EventSort[];
  onSortChange: (sort: EventSort) => void;
  bookmakers: readonly string[];
  onBookmakersChange: (bookmakers: string[]) => void;
  players?: boolean;
  // For the sports with players' markets only.
  onPlayersChange?: (players: boolean) => void;
  // The sport shown, whose competitions are listed (in the matches' list only).
  sport?: string;
  competition?: string;
  competitions?: readonly string[];
  onCompetitionChange?: (competition: string) => void;
  // The sports to star (in the matches' list only).
  sports?: readonly string[];
  favoriteSports?: readonly string[];
  onToggleFavoriteSport?: (sport: string) => void;
  canAddFavoriteSport?: boolean;
  onReset?: () => void;
}) {
  function toggleBookmaker(bookmaker: string, checked: boolean) {
    // ALL_BOOKMAKERS' order, whatever the order of the taps (BookmakerMenu).
    onBookmakersChange(ALL_BOOKMAKERS.filter((b) => (b === bookmaker ? checked : bookmakers.includes(b))));
  }

  return (
    <Sheet
      id={id}
      title="Filter"
      open={open}
      onClose={onClose}
      footer={
        <>
          {onReset && (
            <button type="button" className={styles.reset} onClick={onReset}>
              <RotateCcw size={16} aria-hidden="true" />
              Zurücksetzen
            </button>
          )}
          <button type="button" className={styles.apply} onClick={onClose}>
            {resultsLabel}
          </button>
        </>
      }
    >
      <Group legend="Sortieren nach">
        {sortOrders.map((order) => (
          <Option key={order} type="radio" name="sheet-sort" checked={order === sort} onChange={() => onSortChange(order)}>
            {SORT_LABELS[order]}
          </Option>
        ))}
      </Group>

      {competitions && onCompetitionChange && (
        <Group legend="Wettbewerb">
          <CompetitionPicker
            sport={sport ?? ""}
            value={competition}
            competitions={competitions}
            onChange={onCompetitionChange}
            renderOption={(choice) => (
              <Option
                key={choice.value}
                type="radio"
                name="sheet-competition"
                checked={choice.value === competition}
                onChange={() => onCompetitionChange(choice.value)}
              >
                {choice.label}
              </Option>
            )}
          />
        </Group>
      )}

      <Group legend="Verglichene Buchmacher">
        {ALL_BOOKMAKERS.map((bookmaker) => (
          <Option
            key={bookmaker}
            type="checkbox"
            checked={bookmakers.includes(bookmaker)}
            onChange={(checked) => toggleBookmaker(bookmaker, checked)}
          >
            <BookmakerLogo bookmaker={bookmaker} size={20} decorative />
            {bookmakerName(bookmaker)}
          </Option>
        ))}
      </Group>

      {onPlayersChange && (
        <Group legend="Angezeigte Spiele">
          {MARKETS_OPTIONS.map((option) => (
            <Option
              key={option.label}
              type="radio"
              name="sheet-markets"
              checked={option.value === players}
              onChange={() => onPlayersChange(option.value)}
            >
              {option.label}
            </Option>
          ))}
        </Group>
      )}

      {sports && sports.length > 0 && onToggleFavoriteSport && (
        <fieldset className={styles.group}>
          <legend className={styles.legend}>Lieblingssportarten</legend>
          <p className={styles.hint}>
            Bis zu {MAX_FAVORITES}, ganz vorne in der Liste der Sportarten.
          </p>
          <div className={styles.favorites}>
            {sports.map((sport) => {
              const favorite = favoriteSports?.includes(sport) ?? false;
              return (
                <button
                  key={sport}
                  type="button"
                  className={styles.favorite}
                  aria-pressed={favorite}
                  aria-label={`Favorit: ${sportLabel(sport)}`}
                  disabled={!favorite && !canAddFavoriteSport}
                  onClick={() => onToggleFavoriteSport(sport)}
                >
                  <span aria-hidden="true">{sportEmoji(sport)}</span>
                  {sportLabel(sport)}
                  <Star size={16} aria-hidden="true" className={styles.star} />
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
    </Sheet>
  );
}
