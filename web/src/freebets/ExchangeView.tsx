import { BookmakerLogo } from "../BookmakerLogo";
import { BOOKMAKER_BRANDING } from "../bookmakers";
import { formatPercent, formatStartTime } from "../format";
import { Card } from "./Card";
import { formatEuro, formatFb, formatRate, readAt } from "./format";
import type { BookmakerId, ChainView, StepView } from "./freebetsApi";
import { Gauge } from "./Gauge";
import { Kpis } from "./Kpis";
import { before } from "./cards";
import styles from "./ExchangeView.module.css";

const PARTS = ["partOne", "partTwo", "partThree"] as const;

// The wallet of the bookmaker, drawn as what each conversion takes of it.
export function ChainBar({ chain, bookmaker, fb }: { chain: ChainView; bookmaker: BookmakerId; fb: number }) {
  const name = BOOKMAKER_BRANDING[bookmaker]?.name ?? bookmaker;
  const parts = chain.steps.map((step) => `conversion ${step.rank}: ${formatFb(step.fb)} FB`);
  const aria = `Your ${name} balance of ${formatFb(fb)} FB: ${parts.join(", ")}, not converted: ${formatFb(chain.leftover)} FB`;
  return (
    <Card id="chain-heading" title={`Your ${name} balance of ${formatFb(fb)} FB`}>
      <div className={styles.stack} role="img" aria-label={aria}>
        {chain.steps.map((step, i) => (
          <span key={step.rank} className={styles[PARTS[i]]} style={{ width: `${(step.fb / fb) * 100}%` }} />
        ))}
      </div>
      <p className={styles.legend}>
        {chain.steps.map((step, i) => (
          <span key={step.rank} className={styles.entry}>
            <i className={styles[`swatch${i + 1}` as "swatch1"]} aria-hidden="true" />
            Conversion {step.rank}: <b className="num">{formatFb(step.fb)}</b> FB
          </span>
        ))}
        <span className={styles.entry}>
          Not converted: <b className="num">{formatFb(chain.leftover)}</b> FB
        </span>
      </p>
    </Card>
  );
}

// What each case of the outcome is called: "If Auxerre wins" / "If Auxerre does not win (Brest wins or a draw)".
function cases(step: StepView): { yes: string; no: string } {
  if (step.selection === "X") return { yes: "If the match is a draw", no: `If the match is not a draw (${step.participants.join(" or ")} wins)` };
  const [home, away] = step.participants;
  const other = step.selection === "1" ? away : home;
  const alternatives = step.market === "1X2" ? `${other} wins or a draw` : `${other} wins`;
  return { yes: `If ${step.label} wins`, no: `If ${step.label} does not win (${alternatives})` };
}

const signed = (value: number) => `${value < 0 ? "−" : "+"}${formatEuro(Math.abs(value))}`;

// One conversion in detail: the two bets (the freebet at the bookmaker, the lay on the exchange), what the lay
// asks of the exchange's liquidity, and what is left in each case.
export function StepDetail({ chain, step, bookmaker, fb, commission }: { chain: ChainView; step: StepView; bookmaker: BookmakerId; fb: number; commission: number }) {
  const commissionText = formatPercent(commission);
  const name = BOOKMAKER_BRANDING[bookmaker]?.name ?? bookmaker;
  const { yes, no } = cases(step);
  const left = before(chain, step.rank - 1, fb);
  const after = Math.round((left - step.fb) * 100) / 100;
  const next = chain.steps[step.rank];
  return (
    <Card
      id="step-heading"
      title={`Conversion ${step.rank} · two bets to place`}
      aside={<>Indicative prices read at <span className="num">{readAt(step.oddsAt)}</span> · {step.participants.join(" – ")} · {formatStartTime(step.startTime)} · check before placing</>}
    >
      <Kpis
        items={[
          { label: "Conversion rate", value: formatRate(step.rate), note: "guaranteed cash / FB converted", highlight: true },
          { label: "Guaranteed cash return", value: formatEuro(step.cash), note: "whatever the result" },
          { label: "FB converted", value: `${formatFb(step.fb)} / ${formatFb(fb)}`, note: `of your ${name} balance` },
          { label: "To advance on the exchange", value: formatEuro(step.liability), note: "the lay's liability, returned after the match" },
        ]}
      />
      <div className={styles.steps}>
        <div className={styles.step}>
          <h3 className={styles.stepHead}>
            <span className={`${styles.number} num`}>1</span>
            <BookmakerLogo bookmaker={bookmaker} size={20} decorative />
            {name} · as a freebet
          </h3>
          <p>
            Back <strong className="num">{formatFb(step.fb)} FB</strong> on
          </p>
          <p className={styles.pick}>{step.label}</p>
          <p>
            at odds of <strong className="num">{step.back.toFixed(2)}</strong>
          </p>
          <small>If it wins, the freebet returns {formatEuro(step.ifWins.gain)} (the stake is not returned).</small>
        </div>
        <div className={styles.step}>
          <h3 className={styles.stepHead}>
            <span className={`${styles.number} num`}>2</span>
            <span className={styles.exchange}>EXCHANGE</span>
            Lay
          </h3>
          <p>
            Lay <strong className="num">{formatEuro(step.layStake)}</strong> on
          </p>
          <p className={styles.pick}>{step.label}</p>
          <p>
            at odds of <strong className="num">{step.lay.toFixed(2)}</strong> · {commissionText} commission on winnings
          </p>
          <div className={styles.liquidity}>
            <Gauge to={step.laySize > 0 ? step.layStake / step.laySize : 0} tone={step.limited ? "warning" : "brand"} />
            <span className={styles.liquidityText}>
              Lay needed <b className="num">{formatEuro(step.layStake)}</b> · available on the exchange <b className="num">{formatEuro(step.laySize)}</b>
            </span>
          </div>
        </div>
      </div>
      <h3 className={styles.heading}>
        Whatever the result, you keep {formatEuro(step.ifWins.net) === formatEuro(step.ifLoses.net) ? "" : "at least "}
        {formatEuro(step.cash)}
      </h3>
      <div className={styles.scenarios}>
        <div className={styles.scenario}>
          <b>{yes}</b>
          <p>
            <span>Your freebet wins</span> <span className="num">{signed(step.ifWins.gain)}</span>
          </p>
          <p>
            <span>You pay on the exchange (your lay loses)</span> <span className="num">{signed(-step.ifWins.pays)}</span>
          </p>
          <p className={styles.sum}>
            <span>You keep</span> <span className="num">{signed(step.ifWins.net)}</span>
          </p>
        </div>
        <div className={styles.scenario}>
          <b>{no}</b>
          <p>
            <span>Your freebet is lost (it cost you nothing)</span> <span className="num">{formatEuro(0)}</span>
          </p>
          <p>
            <span>You win on the exchange (your lay wins, less {commissionText} commission)</span> <span className="num">{signed(step.ifLoses.net)}</span>
          </p>
          <p className={styles.sum}>
            <span>You keep</span> <span className="num">{signed(step.ifLoses.net)}</span>
          </p>
        </div>
      </div>
      <p className={step.limited ? styles.calloutWarning : styles.callout}>
        {step.limited
          ? `With this liquidity, only ${formatFb(step.fb)} FB of ${formatFb(left)} FB can be converted here.${next ? ` Move on to conversion ${next.rank} for the remaining ${formatFb(after)} FB.` : ` ${formatFb(after)} FB will be left to convert another way.`}`
          : `This conversion takes all the rest of your ${name} balance (${formatFb(step.fb)} FB): the exchange's liquidity is enough.`}
      </p>
    </Card>
  );
}
