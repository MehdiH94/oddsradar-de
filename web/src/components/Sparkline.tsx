import { BOOKMAKER_BRANDING } from "../bookmakers";
import { formatPrice } from "../format";
import type { PriceMove } from "../types";
import styles from "./Sparkline.module.css";

const WIDTH = 48;
const HEIGHT = 14;
const TIME = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });

// A price's moves of the day as a small line (its prices before each move,
// then its price now), rising to the right when the price went up; its
// points read out ("Verlauf bei LeoVegas: 1,90 → 1,95 → 2,05 seit 09:10").
export function Sparkline({ bookmaker, history, price }: { bookmaker: string; history: readonly PriceMove[]; price: number }) {
  const prices = [...history.map((m) => m.from), price];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const points = prices
    .map((p, i) => `${((i / (prices.length - 1)) * WIDTH).toFixed(1)},${(HEIGHT - 1 - ((p - min) / span) * (HEIGHT - 2)).toFixed(1)}`)
    .join(" ");
  const name = BOOKMAKER_BRANDING[bookmaker]?.name ?? bookmaker;
  const label = `Verlauf bei ${name}: ${prices.map(formatPrice).join(" → ")} seit ${TIME.format(new Date(history[0].at))}`;
  return (
    <svg className={styles.line} width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={label} data-up={price > prices[0] || undefined}>
      <title>{label}</title>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
