import type { CSSProperties } from "react";
import { ALL_BOOKMAKERS } from "../bookmakers";
import { formatPercent, formatPrice } from "../format";
import type { HomeStats } from "../useHomeStats";
import { FairOdds } from "./FairOdds";
import { PriceChip } from "./PriceChip";
import styles from "./HomeLive.module.css";

const TIME_FORMAT = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

// A figure of the strip: "…" while it loads, a dash when it could not be read.
function Figure({ value, loading }: { value: number | null; loading: boolean }) {
  if (value !== null) return <>{value.toLocaleString("fr-FR")}</>;
  return (
    <>
      <span aria-hidden="true">{loading ? "…" : "–"}</span>
      <span className="visually-hidden">{loading ? "chargement" : "indisponible"}</span>
    </>
  );
}

// The product's size, as the API reports it right now. A figure that could
// not be read (null) stays, as a dash: it is not a zero.
export function LiveStats({ stats }: { stats: HomeStats }) {
  const tiles: Array<{ label: string; value: number | null }> = [
    { label: "Matchs suivis", value: stats.matches },
    { label: "Bookmakers comparés", value: ALL_BOOKMAKERS.length },
    { label: "Sports", value: stats.sports === null ? null : stats.sports.length },
  ];
  return (
    <div aria-busy={stats.loading}>
      {/* --tiles: the columns of the row from 768 px, one per card. */}
      <ul className={styles.stats} style={{ "--tiles": tiles.length } as CSSProperties}>
        {tiles.map(({ label, value }) => (
          <li key={label} className={styles.tile}>
            <strong className={`${styles.figure} num`}>
              <Figure value={value} loading={stats.loading} />
            </strong>
            <span className={styles.label}>{label}</span>
          </li>
        ))}
      </ul>
      <p className={styles.updated}>
        {stats.loading ? (
          "Chargement des chiffres…"
        ) : stats.updatedAt ? (
          <>
            Chiffres relevés à <span className="num">{TIME_FORMAT.format(stats.updatedAt)}</span>
          </>
        ) : (
          "Chiffres indisponibles pour le moment."
        )}
      </p>
    </div>
  );
}

// A value bet, made up and said so (no bookmaker is named for a price that does not exist).
const EXAMPLE = {
  teams: "Équipe A - Équipe B",
  competition: "Championnat fictif",
  outcome: "Équipe A",
  market: "Résultat du match",
  price: 2.1,
  fair: 2.0,
};

function ExamplePick() {
  const edge = EXAMPLE.price / EXAMPLE.fair - 1;
  return (
    <li className={styles.card}>
      <p className={styles.competition}>
        <span className={styles.tag}>Exemple</span> {EXAMPLE.competition}
      </p>
      <h4 className={styles.teams}>{EXAMPLE.teams}</h4>
      <p className={styles.bet}>
        <strong>{EXAMPLE.outcome}</strong> · {EXAMPLE.market}
      </p>
      <div className={styles.prices}>
        <PriceChip bookmaker="Un bookmaker" price={EXAMPLE.price} best={false} edge={edge} showLogo={false} />
        <FairOdds fair={EXAMPLE.fair} edge={edge} />
      </div>
      <p className={styles.explain}>
        La cote ({formatPrice(EXAMPLE.price)}) paie {formatPercent(edge)} de plus que la cote juste ({formatPrice(EXAMPLE.fair)}) :
        c'est un value bet.
      </p>
    </li>
  );
}

// What a value bet looks like. The real ones are for accounts, so the home
// shows a made-up example, said to be one.
export function LivePreview() {
  return (
    <div>
      <h3 className={styles.previewTitle}>À quoi ressemble un value bet</h3>
      <ol className={`${styles.cards} ${styles.single}`}>
        <ExamplePick />
      </ol>
    </div>
  );
}
