import { useCallback, useEffect, useRef, useState } from "react";
import { announceUnauthorized } from "./auth/session";
import { BOOKMAKER_BRANDING } from "./bookmakers";
import { formatEdge, formatPrice } from "./format";
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

// A taken surebet: whether its reminder is asked for, and what "Meine
// Surebets" (MyTakenSurebets) shows of it.
export interface TakenInfo {
  remind: boolean;
  eventId: string;
  startTime: string;
  label: string;
  // When its reminder was sent, null before.
  remindedAt: string | null;
  // Its payout when taken (1.024 for +2.4 %), null for one taken before it was kept.
  payoutRate: number | null;
}

// What a taken surebet was worth when taken: its payout over 100 %, and the
// profit for 100 € staked in all ("+2,4 % · 2,40 € auf 100 €").
export function profitLabel(payoutRate: number): string {
  const profit = (100 * (payoutRate - 1)).toFixed(2).replace(".", ",");
  return `${formatEdge(payoutRate - 1)} · ${profit} € auf 100 €`;
}

// The line above "Meine Surebets": how many, and of those whose payout was
// kept, the average payout and the profit expected for 100 € staked on each
// ("5 Surebets · Ø +2,1 % · 10,50 € erwartet bei 100 € je Surebet").
export function summaryLabel(items: readonly Pick<TakenInfo, "payoutRate">[]): string {
  const count = items.length === 1 ? "1 Surebet" : `${items.length} Surebets`;
  const rates = items.map((i) => i.payoutRate).filter((r): r is number => r !== null);
  if (rates.length === 0) return count;
  const profit = rates.reduce((sum, r) => sum + 100 * (r - 1), 0);
  const average = rates.reduce((sum, r) => sum + r, 0) / rates.length;
  const euros = profit.toFixed(2).replace(".", ",");
  return `${count} · Ø ${formatEdge(average - 1)} · ${euros} € erwartet bei 100 € je Surebet`;
}

// The taken surebets by key.
export type TakenSurebets = ReadonlyMap<string, TakenInfo>;

const text = (value: unknown) => (typeof value === "string" ? value : "");

export function readTaken(body: unknown): Map<string, TakenInfo> {
  const list = (body as { taken?: unknown } | null)?.taken;
  const taken = new Map<string, TakenInfo>();
  if (!Array.isArray(list)) return taken;
  for (const item of list) {
    const { key, remind, eventId, startTime, label, remindedAt, payoutRate } = (item ?? {}) as Record<string, unknown>;
    if (typeof key !== "string") continue;
    taken.set(key, {
      remind: remind === true,
      eventId: text(eventId),
      startTime: text(startTime),
      label: text(label),
      remindedAt: typeof remindedAt === "string" ? remindedAt : null,
      payoutRate: typeof payoutRate === "number" ? payoutRate : null,
    });
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

export interface TakenSurebetsState {
  taken: TakenSurebets;
  setTaken: (surebet: Surebet, taken: boolean) => void;
  setRemind: (surebet: Surebet, remind: boolean) => void;
}

// The account's taken surebets, and the ways to change them. A change shows at
// once and is undone if the server refuses it. The dashboard holds one for its
// surebets and "Meine Surebets" together (App); `enabled` false reads nothing,
// for a table given that one.
export function useTakenSurebets(enabled = true): TakenSurebetsState {
  const [taken, setState] = useState<Map<string, TakenInfo>>(() => new Map());
  // The changes made before the account's list came: kept over it, so that a
  // quick click is not undone by the list arriving after it.
  const early = useRef<Map<string, TakenInfo | undefined> | null>(new Map());

  useEffect(() => {
    if (!enabled) return;
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
  }, [enabled]);

  const update = useCallback((key: string, value: TakenInfo | undefined) => {
    early.current?.set(key, value);
    setState((current) => {
      const next = new Map(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  }, []);

  const save = useCallback(
    (surebet: Surebet, remind: boolean, before: TakenInfo | undefined) => {
      const key = surebetKey(surebet);
      const label = takenLabel(surebet);
      // The payout it was taken at stays, as on the server.
      const payoutRate = before ? before.payoutRate : surebet.payoutRate;
      update(key, { remind, eventId: surebet.eventId, startTime: surebet.startTime, label, remindedAt: before?.remindedAt ?? null, payoutRate });
      void send("PUT", { key, eventId: surebet.eventId, startTime: surebet.startTime, label, remind, payoutRate: surebet.payoutRate }).then(
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
