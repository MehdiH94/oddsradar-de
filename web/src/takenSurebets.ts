import { useCallback, useEffect, useRef, useState } from "react";
import { announceUnauthorized } from "./auth/session";
import { BOOKMAKER_BRANDING } from "./bookmakers";
import { formatPrice } from "./format";
import type { Surebet } from "./types";

// The surebets the account has marked as taken (src/auth/takenSurebets.ts),
// kept on the server so that every device shows them: greyed and last on the
// list. One with a bet at the exchange can ask for a reminder by email an hour
// before kick-off, to check that bet was matched there (the owner,
// 26/10/2026); it is asked for by default.

const EXCHANGE = "exchange";

// A surebet's identity: its match, market and legs, not their prices, which
// move. The same as the table's row key.
export function surebetKey(surebet: Surebet): string {
  return `${surebet.eventId}:${surebet.market}:${surebet.legs.map((l) => `${l.selection}@${l.source}:${l.side}`).join("|")}`;
}

export const hasExchangeLeg = (surebet: Surebet): boolean => surebet.legs.some((l) => l.source === EXCHANGE);

// What the reminder says the surebet was: "Galatasaray - Fenerbahçe, Ergebnis:
// Galatasaray @ 20bet 2,04 / Lay Fenerbahçe @ Börse 3,40".
export function takenLabel(surebet: Surebet): string {
  const legs = surebet.legs
    .map((l) => {
      const source = l.source === EXCHANGE ? "Börse" : (BOOKMAKER_BRANDING[l.source]?.name ?? l.source);
      return `${l.side === "lay" ? "Lay " : ""}${l.label} @ ${source} ${formatPrice(l.price)}`;
    })
    .join(" / ");
  return `${surebet.participants.join(" - ")}, ${surebet.marketLabel}: ${legs}`;
}

// The taken surebets by key, each with whether its reminder is asked for.
export type TakenSurebets = ReadonlyMap<string, { remind: boolean }>;

export function readTaken(body: unknown): Map<string, { remind: boolean }> {
  const list = (body as { taken?: unknown } | null)?.taken;
  const taken = new Map<string, { remind: boolean }>();
  if (!Array.isArray(list)) return taken;
  for (const item of list) {
    const { key, remind } = (item ?? {}) as { key?: unknown; remind?: unknown };
    if (typeof key === "string") taken.set(key, { remind: remind === true });
  }
  return taken;
}

async function send(method: "PUT" | "DELETE", body: unknown): Promise<boolean> {
  try {
    const res = await fetch("/api/taken-surebets", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 401) announceUnauthorized();
    return res.ok;
  } catch {
    return false;
  }
}

// The account's taken surebets, and the ways to change them. A change shows at
// once and is undone if the server refuses it.
export function useTakenSurebets(): {
  taken: TakenSurebets;
  setTaken: (surebet: Surebet, taken: boolean) => void;
  setRemind: (surebet: Surebet, remind: boolean) => void;
} {
  const [taken, setState] = useState<Map<string, { remind: boolean }>>(() => new Map());
  // The changes made before the account's list came: kept over it, so that a
  // quick click is not undone by the list arriving after it.
  const early = useRef<Map<string, { remind: boolean } | undefined> | null>(new Map());

  useEffect(() => {
    let alive = true;
    fetch("/api/taken-surebets")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        const changes = early.current;
        early.current = null;
        if (!alive || !body) return;
        const loaded = readTaken(body);
        for (const [key, value] of changes ?? []) {
          if (value) loaded.set(key, value);
          else loaded.delete(key);
        }
        setState(loaded);
      })
      .catch(() => {
        // Only what was marked here is shown as taken: the list stays usable.
        early.current = null;
      });
    return () => {
      alive = false;
    };
  }, []);

  const update = useCallback((key: string, value: { remind: boolean } | undefined) => {
    early.current?.set(key, value);
    setState((current) => {
      const next = new Map(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  }, []);

  const save = useCallback(
    (surebet: Surebet, remind: boolean, before: { remind: boolean } | undefined) => {
      const key = surebetKey(surebet);
      update(key, { remind });
      void send("PUT", { key, eventId: surebet.eventId, startTime: surebet.startTime, label: takenLabel(surebet), remind }).then(
        (ok) => {
          if (!ok) update(key, before);
        }
      );
    },
    [update]
  );

  const setTaken = useCallback(
    (surebet: Surebet, isTaken: boolean) => {
      const key = surebetKey(surebet);
      const before = taken.get(key);
      if (isTaken) {
        save(surebet, hasExchangeLeg(surebet), before);
        return;
      }
      update(key, undefined);
      void send("DELETE", { key }).then((ok) => {
        if (!ok) update(key, before);
      });
    },
    [taken, save, update]
  );

  const setRemind = useCallback(
    (surebet: Surebet, remind: boolean) => save(surebet, remind, taken.get(surebetKey(surebet))),
    [taken, save]
  );

  return { taken, setTaken, setRemind };
}
