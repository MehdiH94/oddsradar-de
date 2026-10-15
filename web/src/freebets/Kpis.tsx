import styles from "./Kpis.module.css";

export interface Kpi {
  label: string;
  value: string;
  note: string;
  // The figure the page is about, set apart.
  highlight?: boolean;
}

// The four figures of a plan, in the order the page reads them.
export function Kpis({ items }: { items: Kpi[] }) {
  return (
    <dl className={styles.kpis}>
      {items.map((kpi) => (
        <div key={kpi.label} className={kpi.highlight ? styles.highlight : styles.kpi}>
          <dt>{kpi.label}</dt>
          <dd className={`${styles.value} num`}>{kpi.value}</dd>
          <dd className={styles.note}>{kpi.note}</dd>
        </div>
      ))}
    </dl>
  );
}
