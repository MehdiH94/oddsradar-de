import { BookmakerLogo } from "../BookmakerLogo";
import { BOOKMAKER_BRANDING } from "../bookmakers";
import { formatStartTime } from "../format";
import { sportLabel } from "../sports";
import { Card } from "./Card";
import { formatEuro, formatFb, formatRate, readAt } from "./format";
import type { MatchView, PlanView } from "./freebetsApi";
import { Kpis } from "./Kpis";
import styles from "./PlanDetail.module.css";

// What the match's outcomes are called in a row of prices: "1", "X", "2".
const keyLabel = (key: string) => key;

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
      <ul className={styles.books} aria-label="Prices at the bookmakers where you hold FB">
        {Object.entries(match.prices).map(([bookmaker, prices]) => (
          <li key={bookmaker} className={styles.book}>
            <BookmakerLogo bookmaker={bookmaker} size={18} />
            <span className={styles.prices}>
              {prices!.map((price, i) => (
                <span key={match.outcomes[i].key} className={styles.price}>
                  <small>{keyLabel(match.outcomes[i].key)}</small>
                  <b className="num">{price.toFixed(2)}</b>
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
      title={`Conversion ${plan.rank} · the ${bets} bets to place`}
      aside={<>Indicative prices read at <span className="num">{readAt(plan.oddsAt)}</span> · check before placing</>}
    >
      <Kpis
        items={[
          { label: "Conversion rate", value: formatRate(plan.rate), note: "guaranteed cash / FB converted", highlight: true },
          { label: "Guaranteed cash return", value: formatEuro(plan.cash), note: "whatever the result" },
          {
            label: "FB converted",
            value: `${formatFb(plan.used)} / ${formatFb(total)}`,
            note: plan.left >= 0.01 ? `${formatFb(plan.left)} FB left` : "the whole balance is converted",
          },
          { label: "Bets to place", value: String(bets), note: `${names.length} bookmaker${names.length === 1 ? "" : "s"}, €0 staked` },
        ]}
      />
      <p className={styles.same}>
        Each of the {bets} bets returns at least <strong>{formatEuro(plan.cash)}</strong> if it comes in. Only one will: the profit is the same, whatever
        {legs > 1 ? ` the result of the ${legs} matches` : " the result of the match"}.
      </p>
      {!plan.exact && (
        <p className={styles.note}>The search was cut short for this plan: a better one may exist.</p>
      )}
      <h3 className={styles.heading}>{legs > 1 ? `The ${legs} matches` : "The match"}</h3>
      <ol className={styles.matches}>
        {plan.matches.map((match, i) => (
          <MatchRow key={match.eventId} match={match} number={i + 1} />
        ))}
      </ol>
    </Card>
  );
}
