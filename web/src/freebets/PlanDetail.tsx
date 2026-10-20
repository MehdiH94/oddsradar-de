import { BookmakerLogo } from "../BookmakerLogo";
import { BOOKMAKER_BRANDING } from "../bookmakers";
import { formatStartTime } from "../format";
import { sportLabel } from "../sports";
import { Card } from "./Card";
import { formatEuro, formatFb, formatOdds, formatRate, readAt } from "./format";
import type { MatchView, PlanView } from "./freebetsApi";
import { Kpis } from "./Kpis";
import styles from "./PlanDetail.module.css";

// What the match's outcomes are called in a row of prices: "1", "X", "2".
const keyLabel = (key: string) => key;

function MatchRow({ match, number }: { match: MatchView; number: number }) {
  return (
    <li className={styles.match}>
      <div className={styles.when}>
        Spiel {number} · {formatStartTime(match.startTime)}
      </div>
      <div className={styles.teams}>
        {match.participants.join(" – ")}
        <span className={styles.competition}>
          {sportLabel(match.sport)}
          {match.competition ? ` · ${match.competition}` : ""}
        </span>
      </div>
      <ul className={styles.books} aria-label="Quoten bei den Buchmachern, bei denen du FB hast">
        {Object.entries(match.prices).map(([bookmaker, prices]) => (
          <li key={bookmaker} className={styles.book}>
            <BookmakerLogo bookmaker={bookmaker} size={18} />
            <span className={styles.prices}>
              {prices!.map((price, i) => (
                <span key={match.outcomes[i].key} className={styles.price}>
                  <small>{keyLabel(match.outcomes[i].key)}</small>
                  <b className="num">{formatOdds(price)}</b>
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
      title={`Umwandlung ${plan.rank} · ${bets} Wetten platzieren`}
      aside={<>Unverbindliche Quoten von <span className="num">{readAt(plan.oddsAt)}</span> Uhr · vor dem Platzieren prüfen</>}
    >
      <Kpis
        items={[
          { label: "Umwandlungsrate", value: formatRate(plan.rate), note: "garantierter Betrag / umgewandelte FB", highlight: true },
          { label: "Garantierte Auszahlung", value: formatEuro(plan.cash), note: "unabhängig vom Ergebnis" },
          {
            label: "Umgewandelte FB",
            value: `${formatFb(plan.used)} / ${formatFb(total)}`,
            note: plan.left >= 0.01 ? `${formatFb(plan.left)} FB übrig` : "das ganze Guthaben wird umgewandelt",
          },
          { label: "Zu platzierende Wetten", value: String(bets), note: `${names.length} Buchmacher, ${formatEuro(0)} eigener Einsatz` },
        ]}
      />
      <p className={styles.same}>
        Jede der {bets} Wetten bringt mindestens <strong>{formatEuro(plan.cash)}</strong>, wenn sie gewinnt. Nur eine gewinnt: Der Gewinn ist derselbe, egal wie
        {legs > 1 ? ` die ${legs} Spiele ausgehen` : " das Spiel ausgeht"}.
      </p>
      {!plan.exact && (
        <p className={styles.note}>Die Suche wurde für diesen Plan abgekürzt: Es gibt vielleicht einen besseren.</p>
      )}
      <h3 className={styles.heading}>{legs > 1 ? `Die ${legs} Spiele` : "Das Spiel"}</h3>
      <ol className={styles.matches}>
        {plan.matches.map((match, i) => (
          <MatchRow key={match.eventId} match={match} number={i + 1} />
        ))}
      </ol>
    </Card>
  );
}
