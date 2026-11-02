import { ArrowDown, ArrowUp } from "lucide-react";
import { formatPrice } from "../format";
import type { PriceMove } from "../types";

const MOVE_TIME = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });

// A price's move within the hour, after the price: an arrow up or down, "Quote
// gestiegen von 1,95 um 14:05" in its tooltip and read out. Nothing when the
// price is back where it was.
export function MoveArrow({ move, price, className }: { move: PriceMove; price: number; className?: string }) {
  if (move.from === price) return null;
  const up = price > move.from;
  const text = `${up ? "gestiegen" : "gefallen"} von ${formatPrice(move.from)} um ${MOVE_TIME.format(new Date(move.at))}`;
  const Arrow = up ? ArrowUp : ArrowDown;
  return (
    <span className={className} data-move={up ? "up" : "down"} title={`Quote ${text}`}>
      <Arrow size={11} strokeWidth={2.5} aria-hidden="true" />
      <span className="visually-hidden"> ({text})</span>
    </span>
  );
}
