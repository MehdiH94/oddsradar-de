import { useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import styles from "./SearchBox.module.css";

// The search field, with its suggestions (a native datalist: keyboard and
// screen reader support for free), a button to clear it, and "/" to jump to
// it from anywhere on the page.
export function SearchBox({
  value,
  suggestions,
  onChange,
}: {
  value: string;
  suggestions: readonly string[];
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className={styles.box}>
      <Search size={18} className={styles.icon} aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        className={styles.input}
        aria-label="Spiel suchen"
        placeholder="Team, Spieler, Rennen…"
        list="event-suggestions"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value ? (
        <button
          type="button"
          className={styles.clear}
          aria-label="Suche löschen"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
        >
          <X size={16} aria-hidden="true" />
        </button>
      ) : (
        <kbd className={styles.shortcut} title="Drücke / zum Suchen">
          /
        </kbd>
      )}
      <datalist id="event-suggestions">
        {suggestions.map((label) => (
          <option key={label} value={label} />
        ))}
      </datalist>
    </div>
  );
}
