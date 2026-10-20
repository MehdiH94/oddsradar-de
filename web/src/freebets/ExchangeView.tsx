import { BookmakerLogo } from "../BookmakerLogo";
import { BOOKMAKER_BRANDING } from "../bookmakers";
import { formatStartTime } from "../format";
import { Card } from "./Card";
import { formatCommission, formatEuro, formatFb, formatOdds, formatRate, readAt } from "./format";
import type { BookmakerId, ChainView, StepView } from "./freebetsApi";
import { Gauge } from "./Gauge";
import { Kpis } from "./Kpis";
import { before } from "./cards";
import styles from "./ExchangeView.module.css";

const PARTS = ["partOne", "partTwo", "partThree"] as const;

// The wallet of the bookmaker, drawn as what each conversion takes of it.
export function ChainBar({ chain, bookmaker, fb }: { chain: ChainView; bookmaker: BookmakerId; fb: number }) {
  const name = BOOKMAKER_BRANDING[bookmaker]?.name ?? bookmaker;
  const parts = chain.steps.map((step) => `Umwandlung ${step.rank}: ${formatFb(step.fb)} FB`);
  const aria = `Dein Guthaben bei ${name}: ${formatFb(fb)} FB. ${parts.join(", ")}, nicht umgewandelt: ${formatFb(chain.leftover)} FB`;
  return (
    <Card id="chain-heading" title={`Dein Guthaben bei ${name}: ${formatFb(fb)} FB`}>
      <div className={styles.stack} role="img" aria-label={aria}>
        {chain.steps.map((step, i) => (
          <span key={step.rank} className={styles[PARTS[i]]} style={{ width: `${(step.fb / fb) * 100}%` }} />
        ))}
      </div>
      <p className={styles.legend}>
        {chain.steps.map((step, i) => (
          <span key={step.rank} className={styles.entry}>
            <i className={styles[`swatch${i + 1}` as "swatch1"]} aria-hidden="true" />
            Umwandlung {step.rank}: <b className="num">{formatFb(step.fb)}</b> FB
          </span>
        ))}
        <span className={styles.entry}>
          Nicht umgewandelt: <b className="num">{formatFb(chain.leftover)}</b> FB
        </span>
      </p>
    </Card>
  );
}

// What each case of the outcome is called: "If Auxerre wins" / "If Auxerre does not win (Brest wins or a draw)".
function cases(step: StepView): { yes: string; no: string } {
  if (step.selection === "X") return { yes: "Wenn das Spiel unentschieden endet", no: `Wenn das Spiel nicht unentschieden endet (${step.participants.join(" oder ")} gewinnt)` };
  const [home, away] = step.participants;
  const other = step.selection === "1" ? away : home;
  const alternatives = step.market === "1X2" ? `${other} gewinnt oder Unentschieden` : `${other} gewinnt`;
  return { yes: `Wenn ${step.label} gewinnt`, no: `Wenn ${step.label} nicht gewinnt (${alternatives})` };
}

const signed = (value: number) => `${value < 0 ? "−" : "+"}${formatEuro(Math.abs(value))}`;

// One conversion in detail: the two bets (the freebet at the bookmaker, the lay on the exchange), what the lay
// asks of the exchange's liquidity, and what is left in each case.
export function StepDetail({ chain, step, bookmaker, fb, commission }: { chain: ChainView; step: StepView; bookmaker: BookmakerId; fb: number; commission: number }) {
  const commissionText = formatCommission(commission);
  const name = BOOKMAKER_BRANDING[bookmaker]?.name ?? bookmaker;
  const { yes, no } = cases(step);
  const left = before(chain, step.rank - 1, fb);
  const after = Math.round((left - step.fb) * 100) / 100;
  const next = chain.steps[step.rank];
  return (
    <Card
      id="step-heading"
      title={`Umwandlung ${step.rank} · zwei Wetten platzieren`}
      aside={<>Unverbindliche Quoten von <span className="num">{readAt(step.oddsAt)}</span> Uhr · {step.participants.join(" – ")} · {formatStartTime(step.startTime)} · vor dem Platzieren prüfen</>}
    >
      <Kpis
        items={[
          { label: "Umwandlungsrate", value: formatRate(step.rate), note: "garantierter Betrag / umgewandelte FB", highlight: true },
          { label: "Garantierte Auszahlung", value: formatEuro(step.cash), note: "unabhängig vom Ergebnis" },
          { label: "Umgewandelte FB", value: `${formatFb(step.fb)} / ${formatFb(fb)}`, note: `von deinem Guthaben bei ${name}` },
          { label: "Vorzustrecken an der Wettbörse", value: formatEuro(step.liability), note: "die Haftung des Lay, nach dem Spiel zurück" },
        ]}
      />
      <div className={styles.steps}>
        <div className={styles.step}>
          <h3 className={styles.stepHead}>
            <span className={`${styles.number} num`}>1</span>
            <BookmakerLogo bookmaker={bookmaker} size={20} decorative />
            {name} · als Freebet
          </h3>
          <p>
            Back <strong className="num">{formatFb(step.fb)} FB</strong> auf
          </p>
          <p className={styles.pick}>{step.label}</p>
          <p>
            zur Quote <strong className="num">{formatOdds(step.back)}</strong>
          </p>
          <small>Gewinnt sie, bringt die Freebet {formatEuro(step.ifWins.gain)} (ohne den Einsatz).</small>
        </div>
        <div className={styles.step}>
          <h3 className={styles.stepHead}>
            <span className={`${styles.number} num`}>2</span>
            <span className={styles.exchange}>WETTBÖRSE</span>
            Lay
          </h3>
          <p>
            Lay <strong className="num">{formatEuro(step.layStake)}</strong> auf
          </p>
          <p className={styles.pick}>{step.label}</p>
          <p>
            zur Quote <strong className="num">{formatOdds(step.lay)}</strong> · {commissionText} Kommission auf Gewinne
          </p>
          <div className={styles.liquidity}>
            <Gauge to={step.laySize > 0 ? step.layStake / step.laySize : 0} tone={step.limited ? "warning" : "brand"} />
            <span className={styles.liquidityText}>
              Benötigter Lay <b className="num">{formatEuro(step.layStake)}</b> · verfügbar an der Wettbörse <b className="num">{formatEuro(step.laySize)}</b>
            </span>
          </div>
        </div>
      </div>
      <h3 className={styles.heading}>
        Unabhängig vom Ergebnis behältst du {formatEuro(step.ifWins.net) === formatEuro(step.ifLoses.net) ? "" : "mindestens "}
        {formatEuro(step.cash)}
      </h3>
      <div className={styles.scenarios}>
        <div className={styles.scenario}>
          <b>{yes}</b>
          <p>
            <span>Deine Freebet gewinnt</span> <span className="num">{signed(step.ifWins.gain)}</span>
          </p>
          <p>
            <span>Du zahlst an der Wettbörse (dein Lay verliert)</span> <span className="num">{signed(-step.ifWins.pays)}</span>
          </p>
          <p className={styles.sum}>
            <span>Du behältst</span> <span className="num">{signed(step.ifWins.net)}</span>
          </p>
        </div>
        <div className={styles.scenario}>
          <b>{no}</b>
          <p>
            <span>Deine Freebet ist verloren (sie hat dich nichts gekostet)</span> <span className="num">{formatEuro(0)}</span>
          </p>
          <p>
            <span>Du gewinnst an der Wettbörse (dein Lay gewinnt, abzüglich {commissionText} Kommission)</span> <span className="num">{signed(step.ifLoses.net)}</span>
          </p>
          <p className={styles.sum}>
            <span>Du behältst</span> <span className="num">{signed(step.ifLoses.net)}</span>
          </p>
        </div>
      </div>
      <p className={step.limited ? styles.calloutWarning : styles.callout}>
        {step.limited
          ? `Bei dieser Liquidität lassen sich hier nur ${formatFb(step.fb)} FB von ${formatFb(left)} FB umwandeln.${next ? ` Mach mit Umwandlung ${next.rank} für die restlichen ${formatFb(after)} FB weiter.` : ` ${formatFb(after)} FB musst du auf anderem Weg umwandeln.`}`
          : `Diese Umwandlung nimmt den ganzen Rest deines Guthabens bei ${name} (${formatFb(step.fb)} FB): Die Liquidität der Wettbörse reicht aus.`}
      </p>
    </Card>
  );
}
