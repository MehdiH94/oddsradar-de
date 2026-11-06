import { useState } from "react";

// "Nur offene" on "Meine Surebets" and "Meine Value Bets": only the bets whose
// match has not started, for a long list on match days. One choice for both
// lists, remembered in the browser like the thin lays' switch.
const ONLY_OPEN_KEY = "oddsblitzer.takenOnlyOpen";

function load(): boolean {
  try {
    return localStorage.getItem(ONLY_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function save(onlyOpen: boolean): void {
  try {
    if (onlyOpen) localStorage.setItem(ONLY_OPEN_KEY, "1");
    else localStorage.removeItem(ONLY_OPEN_KEY);
  } catch {
    // Nothing to do: the choice lasts as long as the page.
  }
}

export function useOnlyOpen(): [boolean, (onlyOpen: boolean) => void] {
  const [onlyOpen, setOnlyOpen] = useState(load);
  return [
    onlyOpen,
    (value: boolean) => {
      setOnlyOpen(value);
      save(value);
    },
  ];
}

// Whether a bet's match has not started yet.
export const isOpen = (startTime: string, now: Date): boolean => !(Date.parse(startTime) <= now.getTime());
