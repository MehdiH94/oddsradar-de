import type { ExchangeOutcome } from "../types";
import { formatPrice } from "../format";
import styles from "./ExchangePrices.module.css";

// Why the exchange has no price: it lists this match's market only from 48
// hours before kick-off (src/reference/run.ts, REFERENCE_HORIZON_MS), and not
// every competition.
const NOT_PRICED = "Die Börse handelt diesen Ausgang nicht, oder das Spiel ist mehr als 7 Tage entfernt";

// "300 €", the exchange's money on a price, to the euro.
const euros = (amount: number) => `${Math.round(amount)} €`;

// The reference market under a bet: the exchange's back and lay of its
// outcome and the money on each, what the bet is measured against; said
// when it doesn't price the outcome, rather than shown as nothing (the owner,
// 24/10/2026).
// `compact`: the matches' lists, three outcomes a row: "Börse 2,04 · 2,08",
// the money on each in the tooltip.
export function ExchangePrices({ prices, compact = false }: { prices?: ExchangeOutcome; compact?: boolean }) {
  if (prices?.back === undefined && prices?.lay === undefined) {
    return (
      <span className={styles.exchange} title={NOT_PRICED}>
        {compact ? "Börse -" : "keine Börsenquote"}
      </span>
    );
  }
  if (compact) {
    const title = `Back ${prices.back !== undefined ? formatPrice(prices.back) : "-"}${prices.backSize !== undefined ? ` (${euros(prices.backSize)})` : ""} · Lay ${prices.lay !== undefined ? formatPrice(prices.lay) : "-"}${prices.laySize !== undefined ? ` (${euros(prices.laySize)})` : ""}: die Quoten der Börse für diesen Ausgang`;
    return (
      <span className={styles.exchange} title={title}>
        Börse {prices.back !== undefined ? formatPrice(prices.back) : "-"} · {prices.lay !== undefined ? formatPrice(prices.lay) : "-"}
      </span>
    );
  }
  const side = (name: string, price?: number, size?: number) =>
    price === undefined ? `${name} -` : `${name} ${formatPrice(price)}${size !== undefined ? ` (${euros(size)})` : ""}`;
  return (
    <span className={styles.exchange} title="Die Quoten der Börse für diesen Ausgang und das Geld darauf: der Referenzmarkt">
      Börse: {side("Back", prices.back, prices.backSize)} · {side("Lay", prices.lay, prices.laySize)}
    </span>
  );
}
