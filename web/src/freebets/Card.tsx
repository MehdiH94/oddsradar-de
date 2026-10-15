import type { ReactNode } from "react";
import styles from "./Card.module.css";

// A white panel of the page, named by its heading (`id` is the heading's, for aria-labelledby).
export function Card({ id, title, aside, children }: { id: string; title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.card} aria-labelledby={id}>
      <div className={styles.head}>
        <h2 id={id} className={styles.title}>
          {title}
        </h2>
        {aside && <div className={styles.aside}>{aside}</div>}
      </div>
      {children}
    </section>
  );
}
