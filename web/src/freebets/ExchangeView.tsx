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
  const parts = chain.steps.map((step) => `conversion ${step.rank} : ${formatFb(step.fb)} FB`);
  const aria = `Votre solde ${name} de ${formatFb(fb)} FB : ${parts.join(", ")}, non converti : ${formatFb(chain.leftover)} FB`;
  return (
    <Card id="chain-heading" title={`Votre solde ${name} de ${formatFb(fb)} FB`}>
      <div className={styles.stack} role="img" aria-label={aria}>
        {chain.steps.map((step, i) => (
          <span key={step.rank} className={styles[PARTS[i]]} style={{ width: `${(step.fb / fb) * 100}%` }} />
        ))}
      </div>
      <p className={styles.legend}>
        {chain.steps.map((step, i) => (
          <span key={step.rank} className={styles.entry}>
            <i className={styles[`swatch${i + 1}` as "swatch1"]} aria-hidden="true" />
            Conversion {step.rank} : <b className="num">{formatFb(step.fb)}</b> FB
          </span>
        ))}
        <span className={styles.entry}>
          Non converti : <b className="num">{formatFb(chain.leftover)}</b> FB
        </span>
      </p>
    </Card>
  );
}

// What each case of the outcome is called: "Si Auxerre gagne" / "Si Auxerre ne gagne pas (Brest gagne ou match nul)".
function cases(step: StepView): { yes: string; no: string } {
  if (step.selection === "X") return { yes: "Si le match est nul", no: `Si le match n'est pas nul (${step.participants.join(" ou ")} gagne)` };
  const [home, away] = step.participants;
  const other = step.selection === "1" ? away : home;
  const alternatives = step.market === "1X2" ? `${other} gagne ou match nul` : `${other} gagne`;
  return { yes: `Si ${step.label} gagne`, no: `Si ${step.label} ne gagne pas (${alternatives})` };
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
      title={`Conversion ${step.rank} · deux paris à placer`}
      aside={<>Cotes indicatives relevées à <span className="num">{readAt(step.oddsAt)}</span> · {step.participants.join(" – ")} · {formatStartTime(step.startTime)} · à vérifier avant de placer</>}
    >
      <Kpis
        items={[
          { label: "Taux de conversion", value: formatRate(step.rate), note: "cash garanti / FB convertis", highlight: true },
          { label: "Retour cash garanti", value: formatEuro(step.cash), note: "quel que soit le résultat" },
          { label: "FB convertis", value: `${formatFb(step.fb)} / ${formatFb(fb)}`, note: `sur votre solde ${name}` },
          { label: "À avancer sur l'exchange", value: formatEuro(step.liability), note: "le risque du lay, rendu après le match" },
        ]}
      />
      <div className={styles.steps}>
        <div className={styles.step}>
          <h3 className={styles.stepHead}>
            <span className={`${styles.number} num`}>1</span>
            <BookmakerLogo bookmaker={bookmaker} size={20} decorative />
            {name} · en freebet
          </h3>
          <p>
            Parier <strong className="num">{formatFb(step.fb)} FB</strong> sur
          </p>
          <p className={styles.pick}>{step.label}</p>
          <p>
            à la cote <strong className="num">{step.back.toFixed(2).replace(".", ",")}</strong>
          </p>
          <small>S'il gagne, le freebet rapporte {formatEuro(step.ifWins.gain)} (la mise n'est pas rendue).</small>
        </div>
        <div className={styles.step}>
          <h3 className={styles.stepHead}>
            <span className={`${styles.number} num`}>2</span>
            <span className={styles.exchange}>EXCHANGE</span>
            Lay
          </h3>
          <p>
            Layer <strong className="num">{formatEuro(step.layStake)}</strong> sur
          </p>
          <p className={styles.pick}>{step.label}</p>
          <p>
            à la cote <strong className="num">{step.lay.toFixed(2).replace(".", ",")}</strong> · commission {commissionText} sur les gains
          </p>
          <div className={styles.liquidity}>
            <Gauge to={step.laySize > 0 ? step.layStake / step.laySize : 0} tone={step.limited ? "warning" : "brand"} />
            <span className={styles.liquidityText}>
              Lay nécessaire <b className="num">{formatEuro(step.layStake)}</b> · disponible sur l'exchange <b className="num">{formatEuro(step.laySize)}</b>
            </span>
          </div>
        </div>
      </div>
      <h3 className={styles.heading}>
        Quel que soit le résultat, il vous reste {formatEuro(step.ifWins.net) === formatEuro(step.ifLoses.net) ? "" : "au moins "}
        {formatEuro(step.cash)}
      </h3>
      <div className={styles.scenarios}>
        <div className={styles.scenario}>
          <b>{yes}</b>
          <p>
            <span>Votre freebet gagne</span> <span className="num">{signed(step.ifWins.gain)}</span>
          </p>
          <p>
            <span>Vous payez sur l'exchange (votre lay perd)</span> <span className="num">{signed(-step.ifWins.pays)}</span>
          </p>
          <p className={styles.sum}>
            <span>Il vous reste</span> <span className="num">{signed(step.ifWins.net)}</span>
          </p>
        </div>
        <div className={styles.scenario}>
          <b>{no}</b>
          <p>
            <span>Votre freebet est perdu (il ne vous a rien coûté)</span> <span className="num">{formatEuro(0)}</span>
          </p>
          <p>
            <span>Vous gagnez sur l'exchange (votre lay gagne, moins {commissionText} de commission)</span> <span className="num">{signed(step.ifLoses.net)}</span>
          </p>
          <p className={styles.sum}>
            <span>Il vous reste</span> <span className="num">{signed(step.ifLoses.net)}</span>
          </p>
        </div>
      </div>
      <p className={step.limited ? styles.calloutWarning : styles.callout}>
        {step.limited
          ? `Avec cette liquidité, seuls ${formatFb(step.fb)} FB sur ${formatFb(left)} FB peuvent être convertis ici.${next ? ` Passez à la conversion ${next.rank} pour les ${formatFb(after)} FB restants.` : ` Il restera ${formatFb(after)} FB à convertir autrement.`}`
          : `Cette conversion absorbe tout le reste de votre solde ${name} (${formatFb(step.fb)} FB) : la liquidité de l'exchange suffit.`}
      </p>
    </Card>
  );
}
