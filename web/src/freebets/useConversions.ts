import { useCallback, useEffect, useState } from "react";
import { fetchConversions, FreebetsError, type ConversionAnswer, type ConversionRequest } from "./freebetsApi";

// A change of settings asks a moment after the last click, so that ticking three sports asks once.
export const ASK_DELAY_MS = 250;
// The odds move with the worker's cycles (minutes apart): the answer is asked for again this often.
export const REFRESH_MS = 60_000;

export interface Conversions {
  // The last answer, and the request it answers. It stays while a new one is on its way.
  answer: ConversionAnswer | null;
  answered: ConversionRequest | null;
  // A request is on its way.
  loading: boolean;
  // The message of the last request when it failed.
  error: string | null;
  updatedAt: Date | null;
  reload(): void;
}

// The answer of GET /api/freebets/conversions for `request` (null: nothing to ask), asked again when it changes,
// when `version` does (the wallet the server holds), every minute and on demand.
export function useConversions(request: ConversionRequest | null, version: number): Conversions {
  const [state, setState] = useState<Pick<Conversions, "answer" | "answered" | "error" | "updatedAt">>({
    answer: null,
    answered: null,
    error: null,
    updatedAt: null,
  });
  const [reloads, setReloads] = useState(0);
  // The question whose answer (or failure) has come. Nothing is asked before the server holds the wallet (version 0).
  const [done, setDone] = useState<string | null>(null);
  const askable = request !== null && version > 0;
  const key = JSON.stringify([request, version]);
  const ask = `${key}|${reloads}`;

  useEffect(() => {
    const [asked, held] = JSON.parse(key) as [ConversionRequest | null, number];
    if (!asked || held === 0) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      fetchConversions(asked, controller.signal)
        .then((answer) => {
          // A newer question has replaced this one: its answer is not about what is on screen.
          if (controller.signal.aborted) return;
          setState({ answer, answered: asked, error: null, updatedAt: new Date() });
          setDone(`${key}|${reloads}`);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setState((current) => ({ ...current, error: err instanceof FreebetsError ? err.message : "Something went wrong. Try again in a moment." }));
          setDone(`${key}|${reloads}`);
        });
    }, ASK_DELAY_MS);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [key, reloads]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState !== "hidden") setReloads((n) => n + 1);
    }, REFRESH_MS);
    return () => clearInterval(interval);
  }, []);

  const reload = useCallback(() => setReloads((n) => n + 1), []);
  return { ...state, loading: askable && done !== ask, reload };
}
