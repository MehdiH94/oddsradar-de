import { Zap } from "lucide-react";
import { BOOKMAKER_BRANDING } from "../bookmakers";
import { BookmakerLogo } from "../BookmakerLogo";
import { formatEdge, formatPrice } from "../format";
import styles from "./BestPrice.module.css";

const bookmakerName = (bookmaker: string) => BOOKMAKER_BRANDING[bookmaker]?.name ?? bookmaker;

// One outcome's best price among the ticked bookmakers, the phone's way of
// showing a match (OddsTable): the outcome ("1", "N", "2"), where to bet (the
// best bookmaker's icon, "+1" when two share it), the price in large figures,
// and under it the value bet's edge, or else the fair odds. A value bet gets
// the amber frame and corner of PriceChip. Read out in one go: "1: 1,66 bei
// Winamax, Value Bet +2,5 %". A boosted price above it (20bet's odds boost)
// follows the price, with the lightning, as in PriceChip: it is never the
// price itself.
export function BestPrice({
  label,
  name,
  price,
  bookmakers,
  fair,
  edge,
  fairLabel = "Fair",
  showFair = false,
  boost,
}: {
  // As shown ("X") and as read out ("Draw").
  label: string;
  name: string;
  price: number | undefined;
  // Every bookmaker at that price.
  bookmakers: readonly string[];
  fair?: number;
  edge?: number;
  // "Fair", or "Fair ≤" for a lay's ceiling.
  fairLabel?: string;
  // Under the price, the fair odds even for a value bet (whose edge is shown
  // elsewhere, the value bets' list's).
  showFair?: boolean;
  // The highest boosted price among the ticked bookmakers, when above the price.
  boost?: { price: number; bookmaker: string };
}) {
  const noteIsEdge = edge !== undefined && !(showFair && fair !== undefined);
  const [first, ...others] = bookmakers;
  const where = bookmakers.map(bookmakerName).join(" und ");
  return (
    <span className={edge === undefined ? styles.tile : `${styles.tile} ${styles.value}`} data-value={edge !== undefined || undefined}>
      <span className={styles.top} aria-hidden="true">
        <span className={styles.label}>{label}</span>
        {first && (
          <span className={styles.where}>
            <BookmakerLogo bookmaker={first} size={16} decorative />
            {others.length > 0 && <span className={styles.others}>+{others.length}</span>}
          </span>
        )}
      </span>
      <span className="visually-hidden">
        {name}: {price === undefined ? "keine Quote" : `${formatPrice(price)} bei ${where}`}
        {edge !== undefined && `, Value Bet ${formatEdge(edge)}`}
        {fair !== undefined && (edge === undefined || showFair) && `, faire Quote ${fairLabel === "Fair" ? "" : "höchstens "}${formatPrice(fair)}`}
        {boost && `, geboostet auf ${formatPrice(boost.price)} bei ${bookmakerName(boost.bookmaker)}`}
      </span>
      <span className={styles.priceRow} aria-hidden="true">
        <span className={`${styles.price} num`}>{price === undefined ? "-" : formatPrice(price)}</span>
        {boost && (
          <span className={`${styles.boost} num`} title={`Quoten-Boost bei ${bookmakerName(boost.bookmaker)}: ${formatPrice(boost.price)}`}>
            <Zap size={12} strokeWidth={2.5} />
            {formatPrice(boost.price)}
          </span>
        )}
      </span>
      {(edge !== undefined || fair !== undefined) && (
        <span className={styles.note} aria-hidden="true">
          {noteIsEdge ? (
            <strong className={styles.edge}>{formatEdge(edge!)}</strong>
          ) : (
            <>
              {fairLabel} <span className="num">{formatPrice(fair!)}</span>
            </>
          )}
        </span>
      )}
    </span>
  );
}
