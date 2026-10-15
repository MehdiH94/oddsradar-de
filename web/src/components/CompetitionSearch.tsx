import { useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import styles from "./CompetitionPicker.module.css";

// The field that narrows the competitions as one types (CompetitionPicker).
export function CompetitionSearch({
  value,
  onChange,
  controls,
  autoFocus = false,
  onEnter,
  onArrowDown,
}: {
  value: string;
  onChange: (value: string) => void;
  // The id of the list it filters.
  controls: string;
  autoFocus?: boolean;
  onEnter: () => void;
  onArrowDown: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  return (
    <div className={styles.search}>
      <Search size={16} className={styles.icon} aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        className={styles.input}
        aria-label="Search for a competition"
        aria-controls={controls}
        placeholder="Search for a competition"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            // Not the menu's Enter, which closes it: this one picks.
            event.preventDefault();
            event.stopPropagation();
            onEnter();
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            onArrowDown();
          }
        }}
      />
      {value && (
        <button
          type="button"
          className={styles.clear}
          aria-label="Clear the competition search"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
