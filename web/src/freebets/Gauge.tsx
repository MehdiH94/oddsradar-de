import styles from "./Gauge.module.css";

// A bar filled from `from` to `to` (0 to 1): decoration, the figures it shows are always written beside it.
export function Gauge({ from = 0, to, tone = "brand" }: { from?: number; to: number; tone?: "brand" | "warning" }) {
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const start = clamp(from);
  const width = Math.max(0, clamp(to) - start);
  return (
    <span className={styles.gauge} aria-hidden="true">
      <span className={tone === "warning" ? styles.warning : styles.fill} style={{ marginLeft: `${start * 100}%`, width: `${width * 100}%` }} />
    </span>
  );
}
