import type { ReactNode } from "react";
import { LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { ADMIN_PATH } from "../routes";
import { Logo } from "./Logo";
import styles from "./AppHeader.module.css";

const TIME_FORMAT = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

// The brand, and how fresh the odds on screen are: the time of the last
// answer from the API, a spinning icon while one is on its way, a warning when
// the last one failed. The button asks for fresh odds at once. On a phone the
// status shrinks to its time ("15:36"), still read out in full; from 768 px
// the views' switch (AppNav, `children`) sits between the two.
export function AppHeader({
  lastUpdated,
  refreshing,
  failed,
  onRefresh,
  children,
}: {
  lastUpdated: Date | null;
  refreshing: boolean;
  failed: boolean;
  onRefresh: () => void;
  children?: ReactNode;
}) {
  const { status: authStatus, user, logout } = useAuth();
  let status: ReactNode = "Chargement des cotes…";
  if (failed) status = "Actualisation impossible";
  else if (lastUpdated)
    status = (
      <>
        <span className={styles.statusLead}>Mis à jour à </span>
        <span className="num">{TIME_FORMAT.format(lastUpdated)}</span>
      </>
    );

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <a className={styles.brand} href="/" aria-label="CoteRadar, accueil">
          <Logo className={styles.logo} />
          <span className={styles.name}>CoteRadar</span>
        </a>
        {children && <div className={styles.nav}>{children}</div>}
        <div className={styles.status}>
          <span className={failed ? styles.dotFailed : styles.dot} aria-hidden="true" />
          <span role="status" className={styles.statusText}>
            {status}
          </span>
          <button
            type="button"
            className={styles.refresh}
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Actualiser les cotes"
          >
            <RefreshCw size={18} aria-hidden="true" className={refreshing ? styles.spinning : undefined} />
          </button>
          {user?.role === "admin" && (
            <a className={styles.refresh} href={ADMIN_PATH} aria-label="Administration">
              <ShieldCheck size={18} aria-hidden="true" />
            </a>
          )}
          {authStatus === "authenticated" && (
            <button type="button" className={styles.refresh} onClick={() => void logout()} aria-label="Se déconnecter">
              <LogOut size={18} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
