import { formatPayoutRate } from "../format";
import { payoutTier } from "../payoutTier";
import styles from "./PayoutBadge.module.css";

// The meter runs from 85 % (empty) to 100 % (full).
const METER_FLOOR = 0.85;

export function PayoutBadge({ rate }: { rate: number | null | undefined }) {
  const tier = payoutTier(rate);
  const fill = rate === null || rate === undefined ? 0 : Math.min(1, Math.max(0, (rate - METER_FLOOR) / (1 - METER_FLOOR)));
  return (
    <span className={`${styles.badge} ${styles[tier]}`} data-tier={tier}>
      <span className={styles.value}>{formatPayoutRate(rate)}</span>
      {tier === "sure" && <span className={styles.flag}>Surebet</span>}
      {tier !== "none" && (
        <span className={styles.meter} aria-hidden="true">
          <span className={styles.fill} style={{ width: `${Math.round(fill * 100)}%` }} />
        </span>
      )}
    </span>
  );
}
