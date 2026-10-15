import { useEffect, useRef } from "react";
import styles from "./GamblingBanner.module.css";

// The German federal help on gambling addiction (BZgA's "Check dein Spiel"
// and its free hotline). To be checked against the GlüStV's requirements
// before going live: this is not legal advice.
const HELP_URL = "https://www.check-dein-spiel.de";

// The banner sticks to the top of the screen, and the bars that stick under it
// (filters, sections of a match) read its height from this variable.
const HEIGHT_VAR = "--banner-height";

// The home page carries the generic message; a page about sports bets, one
// about them.
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
    <aside ref={ref} className={styles.banner} aria-label="Responsible gambling">
      <a className={styles.link} href={HELP_URL} target="_blank" rel="noopener noreferrer">
        <span className={styles.text}>
          <span className={styles.first}>
            {sportsBetting
              ? "18+. Sports betting can be addictive: know when to stop."
              : "18+. Gambling can be addictive: losing money, family conflicts, addiction…"}
          </span>{" "}
          <span className={styles.last}>
            Help at check-dein-spiel.de (BZgA, free hotline <span className={styles.nowrap}>0800 1 37 27 00</span>)
          </span>
        </span>
      </a>
    </aside>
  );
}
