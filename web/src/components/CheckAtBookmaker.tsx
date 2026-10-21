import { ExternalLink } from "lucide-react";
import { BOOKMAKER_BRANDING } from "../bookmakers";
import styles from "./CheckAtBookmaker.module.css";

// The match's page at a bookmaker, in a new tab, to check its price there
// before betting. Its address comes from the API (src/db/bookmakerLinks.ts),
// only when it can be built: nothing otherwise.
export function CheckAtBookmaker({ bookmaker, url }: { bookmaker: string; url: string | undefined }) {
  if (!url) return null;
  const name = BOOKMAKER_BRANDING[bookmaker]?.name ?? bookmaker;
  return (
    <a className={styles.link} href={url} target="_blank" rel="noopener noreferrer" aria-label={`Bei ${name} prüfen`}>
      Seite prüfen
      <ExternalLink size={12} aria-hidden="true" />
    </a>
  );
}
