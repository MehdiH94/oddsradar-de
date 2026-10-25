import type { ExchangeOutcome } from "../types";
import { formatPrice } from "../format";
import styles from "./ExchangePrices.module.css";

// "300 €", the exchange's money on a price, to the euro.
const euros = (amount: number) => `${Math.round(amount)} €`;

// The reference market under a bet: the exchange's back and lay of its
// outcome and the money on each, what the bet is measured against; said
// when it doesn't price the outcome, rather than shown as nothing (the owner,
// 24/10/2026).
export function ExchangePrices({ prices }: { prices?: ExchangeOutcome }) {
  if (prices?.back === undefined && prices?.lay === undefined) {
    return (
      <span className={styles.exchange} title="Die Börse handelt diesen Ausgang nicht">
        keine Börsenquote
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
