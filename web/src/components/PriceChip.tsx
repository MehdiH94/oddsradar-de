import { Check, Zap } from "lucide-react";
import { BOOKMAKER_BRANDING } from "../bookmakers";
import { BookmakerLogo } from "../BookmakerLogo";
import { formatEdge, formatPrice } from "../format";
import styles from "./PriceChip.module.css";

// One bookmaker's price for one outcome. The best price (every bookmaker
// offering it) is green AND ticked, and read out as such: the color is never
// the only sign. A value bet (a price above the reference's fair odds, by
// `edge`) gets an amber frame with a corner mark, its edge written under the
// prices (FairOdds) and read out here; so does a suspect price (`suspect`:
// its edge is over the other bookmaker's price). A bookmaker without a price
// for it shows a dash. `compact` stacks the icon over the price, for a phone
// showing many bookmakers side by side (the chip then has under 3 rem). A
// boosted outcome (20bet's odds boost, `boosted`) shows its boosted price
// after the price, with a lightning: never the best price nor a value bet,
// which the price alone decides.
export function PriceChip({
  bookmaker,
  price,
  best,
  edge,
  suspect = false,
  showLogo = true,
  compact = false,
  boosted,
}: {
  bookmaker: string;
  price: number | undefined;
  best: boolean;
  edge?: number;
  suspect?: boolean;
  showLogo?: boolean;
  compact?: boolean;
  boosted?: number;
}) {
  const name = BOOKMAKER_BRANDING[bookmaker]?.name ?? bookmaker;
  const className = [styles.chip, best && styles.best, edge !== undefined && styles.value, price === undefined && styles.missing, compact && styles.compact]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={className} data-bookmaker={bookmaker} data-best={best || undefined} data-value={edge !== undefined || undefined}>
      {showLogo && <BookmakerLogo bookmaker={bookmaker} size={16} decorative />}
      <span className="visually-hidden">{name}: </span>
      <span className={styles.price}>{price === undefined ? "-" : formatPrice(price)}</span>
      {boosted !== undefined && price !== undefined && (
        <span className={styles.boost} title={`Odds boost: ${formatPrice(boosted)}`}>
          <Zap size={11} strokeWidth={2.5} aria-hidden="true" />
          {formatPrice(boosted)}
          <span className="visually-hidden"> (boosted)</span>
        </span>
      )}
      {best && (
        <>
          <Check size={12} strokeWidth={3} className={styles.check} aria-hidden="true" />
          <span className="visually-hidden"> (best price)</span>
        </>
      )}
      {edge !== undefined && (
        <span className="visually-hidden">
          {suspect
            ? ` (suspect price: ${formatEdge(edge)} over the other bookmaker)`
            : ` (value bet: ${formatEdge(edge)} over the fair odds)`}
        </span>
      )}
    </span>
  );
}
