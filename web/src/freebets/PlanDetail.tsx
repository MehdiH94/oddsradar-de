import { BookmakerLogo } from "../BookmakerLogo";
import { BOOKMAKER_BRANDING } from "../bookmakers";
import { formatStartTime } from "../format";
import { sportLabel } from "../sports";
import { Card } from "./Card";
import { formatEuro, formatFb, formatRate, readAt } from "./format";
import type { MatchView, PlanView } from "./freebetsApi";
import { Kpis } from "./Kpis";
import styles from "./PlanDetail.module.css";

// What the match's outcomes are called in a row of prices: "1", "N", "2".
const keyLabel = (key: string) => (key === "X" ? "N" : key);

function MatchRow({ match, number }: { match: MatchView; number: number }) {
  return (
    <li className={styles.match}>
      <div className={styles.when}>
        Match {number} · {formatStartTime(match.startTime)}
      </div>
      <div className={styles.teams}>
        {match.participants.join(" – ")}
        <span className={styles.competition}>
          {sportLabel(match.sport)}
          {match.competition ? ` · ${match.competition}` : ""}
        </span>
      </div>
      <ul className={styles.books} aria-label="Cotes des bookmakers où vous avez des FB">
        {Object.entries(match.prices).map(([bookmaker, prices]) => (
          <li key={bookmaker} className={styles.book}>
            <BookmakerLogo bookmaker={bookmaker} size={18} />
            <span className={styles.prices}>
              {prices!.map((price, i) => (
                <span key={match.outcomes[i].key} className={styles.price}>
                  <small>{keyLabel(match.outcomes[i].key)}</small>
                  <b className="num">{price.toFixed(2).replace(".", ",")}</b>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}

// One conversion between bookmakers in detail: its figures, the matches it covers with the prices it rests on,
// and (Placement, below it) where to place each bet.
export function PlanDetail({ plan, total, legs }: { plan: PlanView; total: number; legs: number }) {
  const bets = plan.bookmakers.reduce((sum, group) => sum + group.bets.length, 0);
  const names = plan.bookmakers.map((group) => BOOKMAKER_BRANDING[group.bookmaker]?.name ?? group.bookmaker);
  return (
    <Card
      id="plan-heading"
      title={`Conversion ${plan.rank} · les ${bets} paris à placer`}
      aside={<>Cotes indicatives relevées à <span className="num">{readAt(plan.oddsAt)}</span> · à vérifier avant de placer</>}
    >
      <Kpis
        items={[
          { label: "Taux de conversion", value: formatRate(plan.rate), note: "cash garanti / FB convertis", highlight: true },
          { label: "Retour cash garanti", value: formatEuro(plan.cash), note: "quel que soit le résultat" },
          {
            label: "FB convertis",
            value: `${formatFb(plan.used)} / ${formatFb(total)}`,
            note: plan.left >= 0.01 ? `${formatFb(plan.left)} FB restants` : "tout le solde est converti",
          },
          { label: "Paris à placer", value: String(bets), note: `${names.length} bookmaker${names.length > 1 ? "s" : ""}, 0 € de mise` },
        ]}
      />
      <p className={styles.same}>
        Chacun des {bets} paris rapporte <strong>{formatEuro(plan.cash)}</strong> au moins s'il sort. Un seul sortira : le gain est le même, quel que soit
        {legs > 1 ? ` le résultat des ${legs} matchs` : " le résultat du match"}.
      </p>
      {!plan.exact && (
        <p className={styles.note}>La recherche a été interrompue pour ce plan : un meilleur plan existe peut-être.</p>
      )}
      <h3 className={styles.heading}>{legs > 1 ? `Les ${legs} matchs` : "Le match"}</h3>
      <ol className={styles.matches}>
        {plan.matches.map((match, i) => (
          <MatchRow key={match.eventId} match={match} number={i + 1} />
        ))}
      </ol>
    </Card>
  );
}
