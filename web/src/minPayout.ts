import { useState } from "react";

// The surebets list's minimum payout ("Ab 102 %"): 0 shows them all.
// Remembered in the browser like the value bets' minimum edge (./minEdge.ts).
export const MIN_PAYOUTS = [0, 1.01, 1.02, 1.03] as const;
const MIN_PAYOUT_KEY = "oddsblitzer.surebetMinPayout";

function load(): number {
  try {
    const v = Number(localStorage.getItem(MIN_PAYOUT_KEY));
    return (MIN_PAYOUTS as readonly number[]).includes(v) ? v : 0;
  } catch {
    return 0;
  }
}

export function useMinPayout(): [number, (payout: number) => void] {
  const [payout, setPayout] = useState(load);
  return [
    payout,
    (value: number) => {
      setPayout(value);
      try {
        if (value > 0) localStorage.setItem(MIN_PAYOUT_KEY, String(value));
        else localStorage.removeItem(MIN_PAYOUT_KEY);
      } catch {
        // Nothing to do: the choice lasts as long as the page.
      }
    },
  ];
}

// "Alle", "Ab 101 %"…
export const minPayoutLabel = (payout: number): string => (payout === 0 ? "Alle" : `Ab ${Math.round(payout * 100)} %`);
