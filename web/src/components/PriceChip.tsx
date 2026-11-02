import { ArrowDown, ArrowUp, Check, Zap } from "lucide-react";
import type { PriceMove } from "../types";
import { BOOKMAKER_BRANDING, stakeTaxNote } from "../bookmakers";
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
// which the price alone decides. A price that moved within the hour (`moved`)
// shows an arrow up or down after it, its price before and when in the
// arrow's tooltip and read out. Its tooltip says what tax the price is net
// of (stakeTaxNote).
export function PriceChip({
  bookmaker,
  price,
  best,
  edge,
  suspect = false,
  showLogo = true,
  compact = false,
  boosted,
  moved,
}: {
  bookmaker: string;
  price: number | undefined;
  best: boolean;
  edge?: number;
  suspect?: boolean;
  showLogo?: boolean;
  compact?: boolean;
  boosted?: number;
  moved?: PriceMove;
}) {
  const name = BOOKMAKER_BRANDING[bookmaker]?.name ?? bookmaker;
  const className = [styles.chip, best && styles.best, edge !== undefined && styles.value, price === undefined && styles.missing, compact && styles.compact]
    .filter(Boolean)
    .join(" ");
  return (
    <span
      className={className}
      data-bookmaker={bookmaker}
      data-best={best || undefined}
      data-value={edge !== undefined || undefined}
      title={price === undefined ? undefined : stakeTaxNote(bookmaker)}
    >
      {showLogo && <BookmakerLogo bookmaker={bookmaker} size={16} decorative />}
      <span className="visually-hidden">{name}: </span>
      <span className={styles.price}>{price === undefined ? "-" : formatPrice(price)}</span>
      {boosted !== undefined && price !== undefined && (
        <span className={styles.boost} title={`Quoten-Boost: ${formatPrice(boosted)}`}>
          <Zap size={11} strokeWidth={2.5} aria-hidden="true" />
          {formatPrice(boosted)}
          <span className="visually-hidden"> (geboostet)</span>
        </span>
      )}
      {moved && price !== undefined && moved.from !== price && <MoveArrow move={moved} price={price} />}
      {best && (
        <>
          <Check size={12} strokeWidth={3} className={styles.check} aria-hidden="true" />
          <span className="visually-hidden"> (beste Quote)</span>
        </>
      )}
      {edge !== undefined && (
        <span className="visually-hidden">
          {suspect
            ? ` (verdächtige Quote: ${formatEdge(edge)} über dem anderen Buchmacher)`
            : ` (Value Bet: ${formatEdge(edge)} über der fairen Quote)`}
        </span>
      )}
    </span>
  );
}

const MOVE_TIME = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });

// "↑ von 1,95 um 14:05": a price up from its last one, or down.
function MoveArrow({ move, price }: { move: PriceMove; price: number }) {
  const up = price > move.from;
  const text = `${up ? "gestiegen" : "gefallen"} von ${formatPrice(move.from)} um ${MOVE_TIME.format(new Date(move.at))}`;
  const Arrow = up ? ArrowUp : ArrowDown;
  return (
    <span className={styles.move} data-move={up ? "up" : "down"} title={`Quote ${text}`}>
      <Arrow size={11} strokeWidth={2.5} aria-hidden="true" />
      <span className="visually-hidden"> ({text})</span>
    </span>
  );
}
