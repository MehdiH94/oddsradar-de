import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import styles from "./StatusViews.module.css";

// Grey placeholder rows while the first odds load.
export function Skeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className={styles.skeleton}>
      <span className="visually-hidden">Quoten werden geladen…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={styles.skeletonRow} aria-hidden="true">
          <span className={styles.bar} style={{ width: "4rem" }} />
          <span className={styles.bar} style={{ flex: 1, maxWidth: "18rem" }} />
          <span className={styles.bar} style={{ width: "3rem", marginLeft: "auto" }} />
          <span className={styles.bar} style={{ width: "9rem" }} />
        </div>
      ))}
    </div>
  );
}

// A request that failed, with a way to try again.
export function ErrorBanner({ children, onRetry }: { children: ReactNode; onRetry: () => void }) {
  return (
    <div className={styles.banner} role="alert">
      <TriangleAlert size={18} aria-hidden="true" />
      <p>{children}</p>
      <button type="button" className={styles.retry} onClick={onRetry}>
        Erneut versuchen
      </button>
    </div>
  );
}

// Nothing to show, why, and what to do about it.
export function EmptyState({
  children,
  action,
}: {
  children: ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className={styles.empty}>
      <p>{children}</p>
      {action && (
        <button type="button" className={styles.action} onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
