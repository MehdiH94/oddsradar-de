import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Star } from "lucide-react";
import { MAX_FAVORITES, orderSports } from "../favoriteSports";
import { sportEmoji, sportLabel } from "../sports";
import styles from "./SportTabs.module.css";
import { useSideScroll } from "./useSideScroll";

// Share of the visible width one arrow click scrolls by: the last chips in
// view stay in view, so the eye keeps its place.
const SCROLL_STEP = 0.8;

// A constant: a default `[]` would be a new array on each render, and the
// effects below would run on each one.
const NO_FAVORITES: readonly string[] = [];

const scrollBehavior = (): ScrollBehavior =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

// One chip per sport with odds right now. Native radio buttons underneath: the
// arrow keys move between sports, and screen readers announce "Football, 1 of
// 21, selected". The row scrolls sideways when the sports don't fit: by swipe
// on a touch screen, with the ‹ › buttons at its ends with a mouse. The pinned
// one (the value bets' category) sits before the row instead of in it: it stays
// in sight whatever the row's scroll, and is there before the sports load. The
// favorites lead the row: each sport has a star next to its chip (with an
// `onToggleFavorite`), and the pinned one has none.
export function SportTabs({
  sports,
  pinned,
  value,
  onChange,
  favorites = NO_FAVORITES,
  onToggleFavorite,
  canAddFavorite = true,
}: {
  sports: readonly string[];
  pinned?: string;
  value: string;
  onChange: (sport: string) => void;
  favorites?: readonly string[];
  onToggleFavorite?: (sport: string) => void;
  // Whether one more sport can be starred: the stars of the others close once
  // the favorites are at their limit.
  canAddFavorite?: boolean;
}) {
  const barRef = useRef<HTMLFieldSetElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  useSideScroll(barRef, rowRef);
  // Whether some sports are hidden before / after the visible part of the row.
  const [more, setMore] = useState({ before: false, after: false });

  const measure = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    // 1 px of slack: zoomed pages report fractional scroll positions.
    const before = row.scrollLeft > 1;
    const after = row.scrollLeft + row.clientWidth < row.scrollWidth - 1;
    setMore((current) => (current.before === before && current.after === after ? current : { before, after }));
  }, []);

  // Starring a sport moves its chip: everything below follows the row's order,
  // not the sports'.
  const ordered = useMemo(() => orderSports(sports, favorites), [sports, favorites]);

  // The sports arrive after the first render, and can change on each refresh.
  useLayoutEffect(() => measure(), [measure, ordered]);

  // The row's width follows the window's; its chips widen once the web font
  // has loaded.
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    let live = true;
    document.fonts?.ready.then(() => {
      if (live) measure();
    });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(row);
    return () => {
      live = false;
      observer?.disconnect();
    };
  }, [measure]);

  // Keep the chosen sport in view, e.g. "Snooker" from a shared link on a phone.
  useEffect(() => {
    const checked = rowRef.current?.querySelector<HTMLElement>("input:checked");
    checked?.parentElement?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }, [value, sports]);

  // The sport whose star was just clicked: its chip jumps to the front, or back
  // among the others. A new favorite takes the row to its start, where the
  // favorites are, to see them all; an old one is followed to its place.
  // Recentering on the chosen sport instead would slide the row under the
  // pointer, and leave the chip that moved out of sight.
  const toggled = useRef<string | null>(null);
  useEffect(() => {
    const sport = toggled.current;
    toggled.current = null;
    const row = rowRef.current;
    if (sport === null || !row) return;
    if (favorites.includes(sport)) {
      row.scrollTo?.({ left: 0, behavior: scrollBehavior() });
      return;
    }
    const input = [...row.querySelectorAll<HTMLInputElement>("input")].find((candidate) => candidate.value === sport);
    input?.parentElement?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [favorites]);

  function scroll(direction: 1 | -1) {
    const row = rowRef.current;
    if (!row) return;
    row.scrollBy({ left: direction * row.clientWidth * SCROLL_STEP, behavior: scrollBehavior() });
  }

  // A favorite without its star button (a phone's row: they are starred in
  // the filters' sheet) keeps a small star, for the eye only.
  const chip = (sport: string, mark = false) => (
    <label className={styles.chip}>
      <input
        type="radio"
        name="sport"
        className="visually-hidden"
        value={sport}
        checked={sport === value}
        onChange={() => onChange(sport)}
      />
      <span className={styles.face}>
        <span aria-hidden="true">{sportEmoji(sport)}</span>
        {sportLabel(sport)}
        {mark && <Star size={12} aria-hidden="true" className={styles.mark} />}
      </span>
    </label>
  );

  // The star is the chip's sibling, not in its label: a button can't be a
  // radio's label's content. Only the chosen sport's star is in the tab order,
  // so the arrow keys still make for one stop in the row.
  const item = (sport: string) => {
    const favorite = favorites.includes(sport);
    const closed = !favorite && !canAddFavorite;
    const selected = sport === value;
    return (
      <div
        key={sport}
        className={onToggleFavorite ? `${styles.item} ${styles.withStar}` : styles.item}
        data-selected={selected || undefined}
        data-favorite={favorite || undefined}
      >
        {chip(sport, favorite && !onToggleFavorite)}
        {onToggleFavorite && (
          <button
            type="button"
            className={styles.star}
            aria-label={`Favorit: ${sportLabel(sport)}`}
            aria-pressed={favorite}
            title={closed ? `Höchstens ${MAX_FAVORITES} Favoriten` : undefined}
            disabled={closed}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              toggled.current = sport;
              onToggleFavorite(sport);
            }}
          >
            <Star size={14} aria-hidden="true" />
          </button>
        )}
      </div>
    );
  };

  return (
    <fieldset className={styles.group} ref={barRef}>
      <legend className="visually-hidden">Sportart</legend>
      <div className={styles.layout}>
        {pinned && <div className={styles.pinned}>{chip(pinned)}</div>}
        <div className={styles.scroller}>
          <div
            className={styles.row}
            ref={rowRef}
            onScroll={measure}
            data-more-before={more.before || undefined}
            data-more-after={more.after || undefined}
          >
            {ordered.map(item)}
          </div>
          {/* Out of the tab order: from the keyboard, the arrow keys already move
              between sports and bring the chosen one into view. */}
          <button
            type="button"
            className={`${styles.arrow} ${styles.before}`}
            aria-label="Vorherige Sportarten"
            tabIndex={-1}
            hidden={!more.before}
            onClick={() => scroll(-1)}
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`${styles.arrow} ${styles.after}`}
            aria-label="Weitere Sportarten"
            tabIndex={-1}
            hidden={!more.after}
            onClick={() => scroll(1)}
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
    </fieldset>
  );
}
