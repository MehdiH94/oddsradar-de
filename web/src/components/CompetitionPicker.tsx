import { useId, useRef, useState, type ReactNode } from "react";
import { competitionList } from "../competitionList";
import { CompetitionSearch } from "./CompetitionSearch";
import { ALL_COMPETITIONS_LABEL } from "./filterOptions";
import styles from "./CompetitionPicker.module.css";

export interface CompetitionChoice {
  // "" for every competition.
  value: string;
  label: string;
}

// The competitions of a sport to choose one from, on the desktop's menu
// (CompetitionMenu) and the phone's sheet (FilterSheet), which draw the rows:
// a search field (it filters the whole list as the visitor types), then "all",
// the favorites, the other competitions alphabetically, and a button to unfold
// the list, which is folded to the favorites and a few others. Its state (the
// search, the fold) is that of one opening: both mount it only while open.
export function CompetitionPicker({
  sport,
  value,
  competitions,
  onChange,
  renderOption,
  autoFocusSearch = false,
}: {
  sport: string;
  value: string;
  competitions: readonly string[];
  onChange: (competition: string) => void;
  renderOption: (choice: CompetitionChoice) => ReactNode;
  // The menu puts the cursor in the search field; the sheet leaves the phone's
  // keyboard down.
  autoFocusSearch?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const list = competitionList({ sport, competitions, current: value, query, expanded });
  const none = list.searching && list.favorites.length === 0 && list.others.length === 0;
  const choice = (name: string): CompetitionChoice => ({ value: name, label: name });

  return (
    <div ref={rootRef} className={styles.picker}>
      <CompetitionSearch
        value={query}
        onChange={setQuery}
        controls={listId}
        autoFocus={autoFocusSearch}
        // Enter takes the first competition found; ↓ goes down to the rows.
        onEnter={() => {
          const first = list.favorites[0] ?? list.others[0];
          if (first !== undefined) onChange(first);
        }}
        onArrowDown={() => rootRef.current?.querySelector<HTMLElement>("input[type='radio']")?.focus()}
      />
      <div id={listId}>
        {!list.searching && renderOption({ value: "", label: ALL_COMPETITIONS_LABEL })}
        {list.favorites.length > 0 && (
          <div role="group" aria-label="Compétitions phares">
            <p className={styles.heading} aria-hidden="true">
              Compétitions phares
            </p>
            {list.favorites.map((name) => renderOption(choice(name)))}
          </div>
        )}
        {list.others.length > 0 && (
          <div role="group" aria-label={list.favorites.length > 0 ? "Autres compétitions" : "Compétitions"}>
            {list.favorites.length > 0 && (
              <p className={styles.heading} aria-hidden="true">
                Autres compétitions
              </p>
            )}
            {list.others.map((name) => renderOption(choice(name)))}
          </div>
        )}
        {none && (
          <p className={styles.none} role="status">
            Aucune compétition ne correspond à « {query.trim()} ».
          </p>
        )}
      </div>
      {list.foldable && (
        <button type="button" className={styles.toggle} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? "Réduire la liste" : `Afficher les ${list.total} compétitions`}
        </button>
      )}
    </div>
  );
}
