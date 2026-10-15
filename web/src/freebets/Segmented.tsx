import type { ReactNode } from "react";
import styles from "./Segmented.module.css";

export interface Choice<T extends string> {
  value: T;
  label: ReactNode;
  // What a screen reader reads when `label` is not text (a logo and a figure).
  name?: string;
}

// One choice among a few, as buttons side by side. Native radio buttons underneath, hidden: the keyboard, the
// screen readers and the tests find them as they find any radio.
export function Segmented<T extends string>({
  legend,
  name,
  value,
  choices,
  onChange,
}: {
  legend: string;
  name: string;
  value: T | null;
  choices: Choice<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.options}>
        {choices.map((choice) => (
          <label key={choice.value} className={styles.option}>
            <input
              type="radio"
              className="visually-hidden"
              name={name}
              value={choice.value}
              checked={value === choice.value}
              aria-label={choice.name}
              onChange={() => onChange(choice.value)}
            />
            <span className={styles.face}>{choice.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
