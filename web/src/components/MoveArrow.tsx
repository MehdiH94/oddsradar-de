import { ArrowDown, ArrowUp } from "lucide-react";
import { formatPrice } from "../format";
import type { PriceMove } from "../types";

const MOVE_TIME = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });

// A day's moves as a line: "1,90 → 1,95 → 2,05 seit 09:10".
function historyLine(history: readonly PriceMove[], price: number): string {
  return `${[...history.map((m) => m.from), price].map(formatPrice).join(" → ")} seit ${MOVE_TIME.format(new Date(history[0].at))}`;
}

// A price's move within the hour, after the price: an arrow up or down, "Quote
// gestiegen von 1,95 um 14:05" in its tooltip and read out, and the day's
// moves after it when there were more ("· Verlauf: 1,90 → 1,95 → 2,05 seit
// 09:10"). Nothing when the price is back where it was.
export function MoveArrow({
  move,
  price,
  history,
  className,
}: {
  move: PriceMove;
  price: number;
  history?: readonly PriceMove[];
  className?: string;
}) {
  if (move.from === price) return null;
  const up = price > move.from;
  const day = history && history.length >= 2 ? ` · Verlauf: ${historyLine(history, price)}` : "";
  const text = `${up ? "gestiegen" : "gefallen"} von ${formatPrice(move.from)} um ${MOVE_TIME.format(new Date(move.at))}${day}`;
  const Arrow = up ? ArrowUp : ArrowDown;
  return (
    <span className={className} data-move={up ? "up" : "down"} title={`Quote ${text}`}>
      <Arrow size={11} strokeWidth={2.5} aria-hidden="true" />
      <span className="visually-hidden"> ({text})</span>
    </span>
  );
}
