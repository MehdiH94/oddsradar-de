import { ChevronLeft, ChevronRight } from "lucide-react";
import { pageWindow } from "../pageWindow";
import styles from "./Pagination.module.css";

export function Pagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) {
  // At least 1, so an empty result reads "Page 1 / 1" rather than "/ 0".
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <nav className={styles.pagination} aria-label="Pagination">
      <p className={styles.range}>
        {from}–{to} of {total}
      </p>
      <div className={styles.controls}>
        <button type="button" className={styles.step} onClick={() => onChange(page - 1)} disabled={page <= 1}>
          <ChevronLeft size={16} aria-hidden="true" />
          <span className={styles.stepLabel}>Previous</span>
        </button>
        <ol className={styles.pages}>
          {pageWindow(page, lastPage).map((item, i) =>
            item === "gap" ? (
              <li key={`gap-${i}`} className={styles.gap} aria-hidden="true">
                …
              </li>
            ) : (
              <li key={item}>
                <button
                  type="button"
                  className={styles.page}
                  aria-label={`Page ${item}`}
                  aria-current={item === page ? "page" : undefined}
                  onClick={() => onChange(item)}
                >
                  {item}
                </button>
              </li>
            )
          )}
        </ol>
        <span className={styles.compact}>
          Page {page} / {lastPage}
        </span>
        <button type="button" className={styles.step} onClick={() => onChange(page + 1)} disabled={page >= lastPage}>
          <span className={styles.stepLabel}>Next</span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
