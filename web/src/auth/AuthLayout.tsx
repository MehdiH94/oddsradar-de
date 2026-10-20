import type { ReactNode } from "react";
import { APP_NAME } from "../brand";
import { AppFooter } from "../components/AppFooter";
import { GamblingBanner } from "../components/GamblingBanner";
import { Logo } from "../components/Logo";
import { HOME_PATH } from "../routes";
import { BetaBadge } from "../components/BetaBadge";
import styles from "./AuthPages.module.css";

// The frame of every account page: the brand, one card, the site's legal
// bands. A phone's single column; the card only stops growing on a wide screen.
export function AuthLayout({ title, intro, children, footer }: { title: string; intro?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <>
      <GamblingBanner />
      <div className={styles.page}>
        <header className={styles.header}>
          <a className={styles.brand} href={HOME_PATH} aria-label={`${APP_NAME}, Startseite`}>
            <Logo className={styles.logo} />
            <span className={styles.name}>{APP_NAME}</span>
            <BetaBadge />
          </a>
        </header>
        <main className={styles.main}>
          <div className={styles.card}>
            <h1 className={styles.title}>{title}</h1>
            {intro && <p className={styles.intro}>{intro}</p>}
            {children}
          </div>
          {footer && <p className={styles.footer}>{footer}</p>}
        </main>
      </div>
      <AppFooter />
    </>
  );
}
