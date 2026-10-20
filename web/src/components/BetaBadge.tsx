import styles from "./BetaBadge.module.css";

// The site is in its free beta: said next to the brand, so that a tester
// knows a gap is expected and worth reporting (the header's Feedback button).
export function BetaBadge() {
  return (
    <span className={styles.badge} title="Kostenlose Beta-Version: Dein Feedback hilft uns.">
      Beta
    </span>
  );
}
