import { useState } from "react";

// The value bets list's minimum edge ("Ab +5 %"): 0 shows them all. Remembered
// in the browser like the thin lays' switch.
export const MIN_EDGES = [0, 0.03, 0.05, 0.1] as const;
const MIN_EDGE_KEY = "oddsblitzer.valueMinEdge";

function load(): number {
  try {
    const v = Number(localStorage.getItem(MIN_EDGE_KEY));
    return (MIN_EDGES as readonly number[]).includes(v) ? v : 0;
  } catch {
    return 0;
  }
}

export function useMinEdge(): [number, (edge: number) => void] {
  const [edge, setEdge] = useState(load);
  return [
    edge,
    (value: number) => {
      setEdge(value);
      try {
        if (value > 0) localStorage.setItem(MIN_EDGE_KEY, String(value));
        else localStorage.removeItem(MIN_EDGE_KEY);
      } catch {
        // Nothing to do: the choice lasts as long as the page.
      }
    },
  ];
}

// "Alle", "Ab +3 %"…
export const minEdgeLabel = (edge: number): string => (edge === 0 ? "Alle" : `Ab +${Math.round(edge * 100)} %`);
