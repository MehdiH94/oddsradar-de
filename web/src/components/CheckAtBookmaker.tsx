import { ExternalLink } from "lucide-react";
import { BOOKMAKER_BRANDING } from "../bookmakers";
import styles from "./CheckAtBookmaker.module.css";

// The match's page at a bookmaker, in a new tab, to check its price there
// before betting. Its address comes from the API (src/db/bookmakerLinks.ts),
// only when it can be built; otherwise the bookmaker's site, said as such
// ("Zur Website"), so that every leg of a surebet leads to its bookmaker (the
// owner, 25/10/2026). Nothing for a bookmaker without either.
export function CheckAtBookmaker({ bookmaker, url }: { bookmaker: string; url: string | undefined }) {
  const brand = BOOKMAKER_BRANDING[bookmaker];
  const name = brand?.name ?? bookmaker;
  const href = url ?? brand?.site;
  if (!href) return null;
  return (
    <a
      className={styles.link}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={url ? `Bei ${name} prüfen` : `Website von ${name} öffnen`}
    >
      {url ? "Seite prüfen" : "Zur Website"}
      <ExternalLink size={12} aria-hidden="true" />
    </a>
  );
}
