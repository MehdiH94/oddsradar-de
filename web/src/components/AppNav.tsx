import { BadgePercent, Gem, Gift, ListOrdered, SlidersHorizontal } from "lucide-react";
import styles from "./AppNav.module.css";

export type View = "value-bets" | "matches" | "freebets" | "promos";

const VIEWS: ReadonlyArray<{ value: View; label: string; Icon: typeof Gem }> = [
  { value: "value-bets", label: "Value Bets", Icon: Gem },
  { value: "matches", label: "Spiele", Icon: ListOrdered },
  { value: "freebets", label: "Freebets", Icon: Gift },
  { value: "promos", label: "Promos", Icon: BadgePercent },
];

// The site's lists: the value bets (every sport's, the surebets above
// them), the matches, sport by sport (with the winners of their competitions),
// and the Freebets and Promos pages beside them (each at its
// own address: choosing one moves there, see App, FreebetsPage and PromosPage). On a phone a bar fixed at the bottom
// of the screen, under the thumb, with the button that opens the filters'
// sheet (`filters`); from 768 px a switch in the header. Native radio buttons
// underneath, like the sports'.
export function AppNav({
  view,
  onChange,
  placement,
  filters,
}: {
  view: View;
  onChange: (view: View) => void;
  placement: "bar" | "header";
  // The phone's "Filters" button: how many filters differ from their default,
  // and the sheet it opens (FilterSheet).
  filters?: { count: number; open: boolean; onOpen: () => void; controls: string };
}) {
  return (
    <nav className={placement === "bar" ? styles.bar : styles.header} aria-label="Hauptnavigation">
      <fieldset className={styles.group}>
        <legend className="visually-hidden">Anzeigen</legend>
        {VIEWS.map(({ value, label, Icon }) => (
          <label key={value} className={styles.item}>
            <input
              type="radio"
              name="view"
              className="visually-hidden"
              value={value}
              checked={view === value}
              onChange={() => onChange(value)}
            />
            <span className={styles.face}>
              <Icon size={20} aria-hidden="true" className={styles.icon} />
              {label}
            </span>
          </label>
        ))}
      </fieldset>
      {filters && (
        <button
          type="button"
          className={styles.filters}
          aria-haspopup="dialog"
          aria-expanded={filters.open}
          aria-controls={filters.controls}
          // The badge's count, read out: "Filter, 2 aktiv".
          aria-label={
            filters.count > 0 ? `Filter, ${filters.count} aktiv` : undefined
          }
          onClick={filters.onOpen}
        >
          <span className={styles.face}>
            <SlidersHorizontal size={20} aria-hidden="true" className={styles.icon} />
            Filter
            {filters.count > 0 && (
              <span className={styles.badge} aria-hidden="true">
                {filters.count}
              </span>
            )}
          </span>
        </button>
      )}
    </nav>
  );
}
