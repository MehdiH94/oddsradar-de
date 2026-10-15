import type { CSSProperties } from "react";
import { ALL_BOOKMAKERS } from "../bookmakers";
import { formatPercent, formatPrice } from "../format";
import type { HomeStats } from "../useHomeStats";
import { FairOdds } from "./FairOdds";
import { PriceChip } from "./PriceChip";
import styles from "./HomeLive.module.css";

const TIME_FORMAT = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

// A figure of the strip: "…" while it loads, a dash when it could not be read.
function Figure({ value, loading }: { value: number | null; loading: boolean }) {
  if (value !== null) return <>{value.toLocaleString("en-GB")}</>;
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
    { label: "Matches tracked", value: stats.matches },
    { label: "Bookmakers compared", value: ALL_BOOKMAKERS.length },
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
          "Loading the figures…"
        ) : stats.updatedAt ? (
          <>
            Figures as of <span className="num">{TIME_FORMAT.format(stats.updatedAt)}</span>
          </>
        ) : (
          "Figures unavailable for now."
        )}
      </p>
    </div>
  );
}

// A value bet, made up and said so (no bookmaker is named for a price that does not exist).
const EXAMPLE = {
  teams: "Team A - Team B",
  competition: "Made-up league",
  outcome: "Team A",
  market: "Match result",
  price: 2.1,
  fair: 2.0,
};

function ExamplePick() {
  const edge = EXAMPLE.price / EXAMPLE.fair - 1;
  return (
    <li className={styles.card}>
      <p className={styles.competition}>
        <span className={styles.tag}>Example</span> {EXAMPLE.competition}
      </p>
      <h4 className={styles.teams}>{EXAMPLE.teams}</h4>
      <p className={styles.bet}>
        <strong>{EXAMPLE.outcome}</strong> · {EXAMPLE.market}
      </p>
      <div className={styles.prices}>
        <PriceChip bookmaker="A bookmaker" price={EXAMPLE.price} best={false} edge={edge} showLogo={false} />
        <FairOdds fair={EXAMPLE.fair} edge={edge} />
      </div>
      <p className={styles.explain}>
        The price ({formatPrice(EXAMPLE.price)}) pays {formatPercent(edge)} more than the fair odds ({formatPrice(EXAMPLE.fair)}):
        it is a value bet.
      </p>
    </li>
  );
}

// What a value bet looks like. The real ones are for accounts, so the home
// shows a made-up example, said to be one.
export function LivePreview() {
  return (
    <div>
      <h3 className={styles.previewTitle}>What a value bet looks like</h3>
      <ol className={`${styles.cards} ${styles.single}`}>
        <ExamplePick />
      </ol>
    </div>
  );
}
