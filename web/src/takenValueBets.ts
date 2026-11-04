import { useCallback, useEffect, useRef, useState } from "react";
import { announceUnauthorized } from "./auth/session";
import { formatEdge } from "./format";
import type { ValueBet } from "./types";

// The value bets the account has marked as taken (src/auth/takenValueBets.ts),
// kept on the server so that every device shows them: greyed and last on the
// list, and in "Meine Value Bets" (MyTakenValueBets) with the edge they were
// taken at and, once their match started, their closing price.

// A value bet's identity: its match, market, outcome and bookmaker, not its
// price, which moves.
export const valueBetKey = (bet: ValueBet): string => `${bet.eventId}:${bet.market}:${bet.selection}:${bet.bookmaker}`;

// What "Meine Value Bets" says it was: "Galatasaray - Fenerbahçe, Ergebnis: Fenerbahçe".
export const valueBetLabel = (bet: ValueBet): string => `${bet.participants.join(" - ")}, ${bet.marketLabel}: ${bet.label}`;

export interface TakenValueBet {
  eventId: string;
  startTime: string;
  label: string;
  market: string;
  selection: string;
  bookmaker: string;
  // Its price and edge when taken.
  price: number;
  edge: number;
  // Once its match started, the bookmaker's last price before kick-off (null
  // when none was read); absent before.
  closing?: number | null;
}

export type TakenValueBets = ReadonlyMap<string, TakenValueBet>;

const text = (v: unknown) => (typeof v === "string" ? v : "");

export function readTakenValueBets(body: unknown): Map<string, TakenValueBet> {
  const list = (body as { taken?: unknown } | null)?.taken;
  const taken = new Map<string, TakenValueBet>();
  if (!Array.isArray(list)) return taken;
  for (const item of list) {
    const r = (item ?? {}) as Record<string, unknown>;
    if (typeof r.key !== "string" || typeof r.price !== "number" || typeof r.edge !== "number") continue;
    taken.set(r.key, {
      eventId: text(r.eventId),
      startTime: text(r.startTime),
      label: text(r.label),
      market: text(r.market),
      selection: text(r.selection),
      bookmaker: text(r.bookmaker),
      price: r.price,
      edge: r.edge,
      ...(r.closing === null || typeof r.closing === "number" ? { closing: r.closing } : {}),
    });
  }
  return taken;
}

// How much better than its closing price it was taken (the closing line
// value), null without one: "+6,1 % gegenüber dem Schlusskurs 3,30".
export function closingValue(bet: TakenValueBet): number | null {
  return typeof bet.closing === "number" && bet.closing > 1 ? bet.price / bet.closing - 1 : null;
}

// Above the list: the average edge taken and, of the played ones with a
// closing price, the average closing line value ("3 Value Bets · Ø Vorteil
// +4,2 % · Ø +2,1 % gegenüber dem Schlusskurs (2)").
export function valueSummaryLabel(list: readonly TakenValueBet[]): string {
  const count = list.length === 1 ? "1 Value Bet" : `${list.length} Value Bets`;
  if (list.length === 0) return count;
  const edge = list.reduce((sum, b) => sum + b.edge, 0) / list.length;
  const values = list.map(closingValue).filter((v): v is number => v !== null);
  const clv = values.length > 0 ? ` · Ø ${formatEdge(values.reduce((a, b) => a + b, 0) / values.length)} gegenüber dem Schlusskurs (${values.length})` : "";
  return `${count} · Ø Vorteil ${formatEdge(edge)}${clv}`;
}

async function send(method: "PUT" | "DELETE", body: unknown): Promise<boolean> {
  try {
    const res = await fetch("/api/taken-value-bets", {
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

export interface TakenValueBetsState {
  taken: TakenValueBets;
  setTaken: (bet: ValueBet, taken: boolean) => void;
}

// The account's taken value bets, and the way to change them: a change shows
// at once and is undone if the server refuses it. The dashboard holds one for
// its value bets and "Meine Value Bets" together (App).
export function useTakenValueBets(enabled = true): TakenValueBetsState {
  const [taken, setState] = useState<Map<string, TakenValueBet>>(() => new Map());
  // The changes made before the account's list came: kept over it.
  const early = useRef<Map<string, TakenValueBet | undefined> | null>(new Map());

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetch("/api/taken-value-bets")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        const changes = early.current;
        early.current = null;
        if (!alive || !body) return;
        const loaded = readTakenValueBets(body);
        for (const [key, value] of changes ?? []) {
          if (value) loaded.set(key, value);
          else loaded.delete(key);
        }
        setState(loaded);
      })
      .catch(() => {
        early.current = null;
      });
    return () => {
      alive = false;
    };
  }, [enabled]);

  const update = useCallback((key: string, value: TakenValueBet | undefined) => {
    early.current?.set(key, value);
    setState((current) => {
      const next = new Map(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  }, []);

  const setTaken = useCallback(
    (bet: ValueBet, isTaken: boolean) => {
      const key = valueBetKey(bet);
      const before = taken.get(key);
      if (!isTaken) {
        update(key, undefined);
        void send("DELETE", { key }).then((ok) => {
          if (!ok) update(key, before);
        });
        return;
      }
      const value: TakenValueBet = before ?? {
        eventId: bet.eventId,
        startTime: bet.startTime,
        label: valueBetLabel(bet),
        market: bet.market,
        selection: bet.selection,
        bookmaker: bet.bookmaker,
        price: bet.price,
        edge: bet.edge,
      };
      update(key, value);
      void send("PUT", { key, ...value }).then((ok) => {
        if (!ok) update(key, before);
      });
    },
    [taken, update]
  );

  return { taken, setTaken };
}
