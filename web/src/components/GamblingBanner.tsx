import { useEffect, useRef } from "react";
import governmentLogo from "../assets/gouvernement.png";
import styles from "./GamblingBanner.module.css";

const HELP_URL = "https://www.joueurs-info-service.fr";

// The banner sticks to the top of the screen, and the bars that stick under it
// (filters, sections of a match) read its height from this variable.
const HEIGHT_VAR = "--banner-height";

// The home page carries the generic message; a page about sports bets, the
// one of the arrêté du 4 mars 2026 for them (annexe, III).
export function GamblingBanner({ sportsBetting = false }: { sportsBetting?: boolean }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const banner = ref.current;
    if (!banner) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty(HEIGHT_VAR, `${banner.offsetHeight}px`);
    publish();
    if (typeof ResizeObserver === "undefined") return () => root.style.removeProperty(HEIGHT_VAR);
    const observer = new ResizeObserver(publish);
    observer.observe(banner);
    return () => {
      observer.disconnect();
      root.style.removeProperty(HEIGHT_VAR);
    };
  }, []);

  return (
    <aside ref={ref} className={styles.banner} aria-label="Prévention des jeux d'argent">
      <a className={styles.link} href={HELP_URL} target="_blank" rel="noopener noreferrer">
        <span className={styles.text}>
          <span className={styles.first}>
            {sportsBetting
              ? "Parce qu'un parieur doit savoir quand quitter le jeu."
              : "Les jeux d'argent et de hasard peuvent être dangereux : pertes d'argent, conflits familiaux, addiction…"}
          </span>{" "}
          <span className={styles.last}>
            {sportsBetting ? "Rendez-vous sur" : "Nos conseils sur"} joueurs-info-service.fr (
            <span className={styles.nowrap}>09-74-75-13-13</span> - appel non surtaxé)
          </span>
        </span>
        <span className={styles.logo}>
          <img src={governmentLogo} alt="Gouvernement. Liberté, Égalité, Fraternité" />
        </span>
      </a>
    </aside>
  );
}
