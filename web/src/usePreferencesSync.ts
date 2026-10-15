import { useEffect, useRef } from "react";
import { savePreferences, type Preferences } from "./preferences";

export const SAVE_DELAY_MS = 1000;

// Sends the account's preferences to the server when the visitor changes them,
// a second after the last change. Nothing goes on mount, nor for the filters a
// link brought: opening someone's link must not rewrite the saved ones.
//
// `enabled` holds it back until the filters are settled (App corrects a sport
// with no matches once the sports are in): the filters at that moment are the
// ones later changes are compared to. A save that fails is not retried; the
// next change sends everything again.
export function usePreferencesSync(current: Preferences, enabled: boolean): void {
  // By value, so that the effect runs on a change and not on a new array.
  const key = JSON.stringify(current);
  const sent = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (sent.current === null) {
      sent.current = key;
      return;
    }
    if (key === sent.current) return;
    const timeout = setTimeout(() => {
      sent.current = key;
      void savePreferences(JSON.parse(key) as Preferences);
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [enabled, key]);
}
