import { Logo } from "./Logo";
import { Link } from "./Link";
import { useAuth } from "../auth/useAuth";
import { HOME_PATH, LOGIN_PATH, oddsHref } from "../routes";
import styles from "./HomeHeader.module.css";

// The home's header: the brand, and the way into the dashboard, always in
// reach. Room for other entries beside it, when the site has other pages.
export function HomeHeader() {
  const { status } = useAuth();
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <a className={styles.brand} href={HOME_PATH} aria-label="CoteRadar, accueil">
          <Logo className={styles.logo} />
          <span className={styles.name}>CoteRadar</span>
        </a>
        <nav aria-label="Navigation principale">
          {status === "authenticated" ? (
            <Link href={oddsHref} className={styles.enter}>
              Voir les cotes
            </Link>
          ) : (
            <Link href={LOGIN_PATH} className={styles.enter}>
              Se connecter
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
