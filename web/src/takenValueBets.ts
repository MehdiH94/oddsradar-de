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
  // The stake placed on it, null or absent when not written down.
  stake?: number | null;
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
      ...(typeof r.stake === "number" ? { stake: r.stake } : {}),
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
// +4,2 % · Ø +2,1 % gegenüber dem Schlusskurs (2)"). Both are weighted by the
// stakes once every one counted has one, as a bet's weight is its stake.
export function valueSummaryLabel(list: readonly TakenValueBet[]): string {
  const count = list.length === 1 ? "1 Value Bet" : `${list.length} Value Bets`;
  if (list.length === 0) return count;
  const average = (items: readonly { value: number; stake?: number | null }[]) => {
    const weighted = items.every((i) => typeof i.stake === "number" && i.stake > 0);
    const weight = (i: { stake?: number | null }) => (weighted ? (i.stake as number) : 1);
    const total = items.reduce((sum, i) => sum + weight(i), 0);
    return items.reduce((sum, i) => sum + i.value * weight(i), 0) / total;
  };
  const edge = average(list.map((b) => ({ value: b.edge, stake: b.stake })));
  const values = list.flatMap((b) => {
    const value = closingValue(b);
    return value === null ? [] : [{ value, stake: b.stake }];
  });
  const clv = values.length > 0 ? ` · Ø ${formatEdge(average(values))} gegenüber dem Schlusskurs (${values.length})` : "";
  return `${count} · Ø Vorteil ${formatEdge(edge)}${clv}`;
}

const euros = (v: number) => `${v.toFixed(2).replace(".", ",")} €`;

// What a stake is expected to win at the edge it was taken at: stake × edge
// ("erwartet +0,90 €"), null without a stake.
export function expectedLabel(bet: TakenValueBet): string | null {
  return typeof bet.stake === "number" && bet.stake > 0 ? `erwartet +${euros(bet.stake * bet.edge)}` : null;
}

// The stakes written down and what they are expected to win ("Einsatz
// 150,00 € · erwartet +6,30 €"), null when none is.
export function stakesSummaryLabel(list: readonly TakenValueBet[]): string | null {
  const staked = list.filter((b) => typeof b.stake === "number" && b.stake > 0);
  if (staked.length === 0) return null;
  const total = staked.reduce((sum, b) => sum + (b.stake as number), 0);
  const expected = staked.reduce((sum, b) => sum + (b.stake as number) * b.edge, 0);
  return `Einsatz ${euros(total)} · erwartet +${euros(expected)}`;
}

// The month's results the server keeps for the value bets it has forgotten
// (src/auth/takenValueBets.ts, monthValueBetResults).
export interface ValueBetResults {
  month: string;
  count: number;
  staked: number;
  expected: number;
  clvSum: number;
  clvStake: number;
}

export function readValueBetResults(body: unknown): ValueBetResults | null {
  const r = (body as { results?: unknown } | null)?.results as Record<string, unknown> | undefined;
  if (!r || typeof r.month !== "string") return null;
  const n = (k: string) => (typeof r[k] === "number" ? (r[k] as number) : null);
  const [count, staked, expected, clvSum, clvStake] = ["count", "staked", "expected", "clvSum", "clvStake"].map(n);
  if (count === null || staked === null || expected === null || clvSum === null || clvStake === null) return null;
  return { month: r.month, count, staked, expected, clvSum, clvStake };
}

const BERLIN_MONTH = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit" });
const MONTH_NAME = new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", month: "long" });

// The month's total above "Meine Value Bets": the server's results, and the
// value bets still held whose match started this month (Berlin) with a stake
// ("November: 12 Value Bets · 340,00 € Einsatz · erwartet +14,20 € · Ø +2,3 %
// gegenüber dem Schlusskurs"), the closing line value weighted by stake. Null with none.
export function monthValueLabel(results: ValueBetResults | null, taken: readonly TakenValueBet[], now: Date): string | null {
  const month = BERLIN_MONTH.format(now).slice(0, 7);
  const sum = results?.month === month ? { ...results } : { month, count: 0, staked: 0, expected: 0, clvSum: 0, clvStake: 0 };
  for (const bet of taken) {
    const start = Date.parse(bet.startTime);
    if (!(start <= now.getTime()) || BERLIN_MONTH.format(new Date(start)).slice(0, 7) !== month) continue;
    if (!(typeof bet.stake === "number" && bet.stake > 0)) continue;
    sum.count += 1;
    sum.staked += bet.stake;
    sum.expected += bet.stake * bet.edge;
    const value = closingValue(bet);
    if (value !== null) {
      sum.clvSum += bet.stake * value;
      sum.clvStake += bet.stake;
    }
  }
  if (sum.count === 0) return null;
  const name = MONTH_NAME.format(new Date(`${month}-15T00:00:00Z`));
  const bets = sum.count === 1 ? "1 Value Bet" : `${sum.count} Value Bets`;
  const clv = sum.clvStake > 0 ? ` · Ø ${formatEdge(sum.clvSum / sum.clvStake)} gegenüber dem Schlusskurs` : "";
  return `${name}: ${bets} · ${euros(sum.staked)} Einsatz · erwartet +${euros(sum.expected)}${clv}`;
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

async function sendStake(key: string, stake: number | null): Promise<boolean> {
  try {
    const res = await fetch("/api/taken-value-bets/stake", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, stake }),
    });
    if (res.status === 401) announceUnauthorized();
    return res.ok;
  } catch {
    return false;
  }
}

export interface TakenValueBetsState {
  taken: TakenValueBets;
  // The month's results of the value bets the server has forgotten.
  results?: ValueBetResults | null;
  setTaken: (bet: ValueBet, taken: boolean) => void;
  // Writes down the stake placed on a taken value bet (by its key).
  setStake?: (key: string, stake: number | null) => void;
}

// The account's taken value bets, and the way to change them: a change shows
// at once and is undone if the server refuses it. The dashboard holds one for
// its value bets and "Meine Value Bets" together (App).
export function useTakenValueBets(enabled = true): TakenValueBetsState {
  const [taken, setState] = useState<Map<string, TakenValueBet>>(() => new Map());
  const [results, setResults] = useState<ValueBetResults | null>(null);
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
        setResults(readValueBetResults(body));
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

  const setStake = useCallback(
    (key: string, stake: number | null) => {
      const before = taken.get(key);
      if (!before) return;
      update(key, { ...before, stake });
      void sendStake(key, stake).then((ok) => {
        if (!ok) update(key, before);
      });
    },
    [taken, update]
  );

  return { taken, results, setTaken, setStake };
}
