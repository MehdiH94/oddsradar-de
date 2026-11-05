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
  // Its legs as taken, absent for one taken before they were kept. Once its
  // match started, each back at a bookmaker with its closing price (null when
  // none was read before kick-off).
  legs?: TakenLeg[];
  // The stakes actually placed, by leg (null: not written down).
  stakes?: (number | null)[];
}

export interface TakenLeg {
  market: string;
  selection: string;
  source: string;
  side: "back" | "lay";
  price: number;
  closing?: number | null;
}

// The legs as the server keeps them (src/auth/takenSurebets.ts, TakenLeg).
export const takenLegs = (surebet: Surebet): TakenLeg[] =>
  surebet.legs.map((l) => ({ market: surebet.market, selection: l.selection, source: l.source, side: l.side, price: l.price }));

// How much better than its closing price a leg was taken (the closing line
// value): a back above it, a lay below it. Null without a closing price.
export function closingValue(leg: TakenLeg): number | null {
  if (typeof leg.closing !== "number") return null;
  return leg.side === "lay" ? leg.closing / leg.price - 1 : leg.price / leg.closing - 1;
}

// A leg's price against its closing price: "Schlusskurs bei 20bet 1,98
// (+3,0 %)", "Schlusskurs Lay an der Börse 3,50 (+2,9 %)", positive when it
// beat the close. Null without a closing price.
export function closingLabel(leg: TakenLeg): string | null {
  const value = closingValue(leg);
  if (value === null || typeof leg.closing !== "number") return null;
  const where = leg.source === EXCHANGE ? "an der Börse" : `bei ${BOOKMAKER_BRANDING[leg.source]?.name ?? leg.source}`;
  return `Schlusskurs ${leg.side === "lay" ? "Lay " : ""}${where} ${formatPrice(leg.closing)} (${formatEdge(value)})`;
}

// Over every leg with a closing price, how much better than the close they
// were taken on average: "Ø +2,1 % gegenüber dem Schlusskurs (4 Wetten)".
// Null while none has one.
export function closingSummaryLabel(items: readonly Pick<TakenInfo, "legs">[]): string | null {
  const values = items.flatMap((i) => i.legs ?? []).map(closingValue).filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  const average = values.reduce((sum, v) => sum + v, 0) / values.length;
  return `Ø ${formatEdge(average)} gegenüber dem Schlusskurs (${values.length === 1 ? "1 Wette" : `${values.length} Wetten`})`;
}

function readLegs(value: unknown): TakenLeg[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const legs: TakenLeg[] = [];
  for (const item of value) {
    const { market, selection, source, side, price, closing } = (item ?? {}) as Record<string, unknown>;
    if (typeof price !== "number" || (side !== "back" && side !== "lay")) continue;
    legs.push({ market: text(market), selection: text(selection), source: text(source), side, price, closing: typeof closing === "number" ? closing : null });
  }
  return legs;
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
    const { key, remind, eventId, startTime, label, remindedAt, payoutRate, legs, stakes } = (item ?? {}) as Record<string, unknown>;
    if (typeof key !== "string") continue;
    const read = readLegs(legs);
    taken.set(key, {
      ...(read ? { legs: read } : {}),
      ...(Array.isArray(stakes) ? { stakes: stakes.map((s) => (typeof s === "number" ? s : null)) } : {}),
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
  // The month's results of the surebets the server has forgotten.
  results: MonthResults | null;
  setTaken: (surebet: Surebet, taken: boolean) => void;
  setRemind: (surebet: Surebet, remind: boolean) => void;
  // Writes down the stakes placed on a taken surebet's legs (by its key).
  setStakes: (key: string, stakes: (number | null)[]) => void;
  // Takes the mark off a taken surebet by its key, once it left the list too.
  remove: (key: string) => void;
}

// The exchange's commission on a market's net winnings (src/db/surebets.ts,
// EXCHANGE_COMMISSION).
export const EXCHANGE_COMMISSION = 0.03;

// What a lay leg risks: its stake times its price less one.
export const layLiability = (stake: number, price: number): number => stake * (price - 1);

// What the stakes written down lock in, once every leg has one: the worst
// result over the outcomes, each leg settled as the surebets list computes it
// (a back at the exchange or a won lay less the exchange's commission on its
// winnings; a lost lay costs its liability). With a lay, the outcomes are its
// selection winning or not. "Gesichert: +2,40 € bei 100,00 € Einsatz", with a
// lay "… bei 100,00 € Einsatz und 108,00 € Haftung". Null otherwise.
export function lockedLabel(legs: readonly TakenLeg[] | undefined, stakes: readonly (number | null)[] | undefined): string | null {
  const result = lockedResult(legs, stakes);
  if (!result) return null;
  const { worst, backs, liability } = result;
  const at = liability > 0 ? `bei ${euros(backs)} Einsatz und ${euros(liability)} Haftung` : `bei ${euros(backs)} Einsatz`;
  return worst >= -0.005 ? `Gesichert: +${euros(Math.max(worst, 0))} ${at}` : `Möglicher Verlust: −${euros(-worst)} ${at}`;
}

const euros = (v: number) => `${v.toFixed(2).replace(".", ",")} €`;

// lockedLabel's numbers: the worst result in euros, the backs' stakes and the
// lays' liability. The same as the server's (src/auth/takenSurebets.ts,
// lockedProfit), which keeps it once the surebet is forgotten.
export function lockedResult(
  legs: readonly TakenLeg[] | undefined,
  stakes: readonly (number | null)[] | undefined
): { worst: number; backs: number; liability: number } | null {
  if (!legs || !stakes || legs.length === 0) return null;
  if (legs.some((_, i) => typeof stakes[i] !== "number")) return null;
  const stake = (i: number) => stakes[i] as number;
  const backs = legs.reduce((sum, l, i) => sum + (l.side === "back" ? stake(i) : 0), 0);
  const liability = legs.reduce((sum, l, i) => sum + (l.side === "lay" ? layLiability(stake(i), l.price) : 0), 0);
  if (backs + liability <= 0) return null;
  const settle = (winner: string | null) =>
    legs.reduce((sum, l, i) => {
      const wins = l.selection === winner;
      if (l.side === "lay") return sum + (wins ? -layLiability(stake(i), l.price) : stake(i) * (1 - EXCHANGE_COMMISSION));
      const cut = l.source === EXCHANGE ? 1 - EXCHANGE_COMMISSION : 1;
      return sum + (wins ? stake(i) * (l.price - 1) * cut : -stake(i));
    }, 0);
  // A back and its lay share one selection: the other outcome is any other.
  const outcomes: (string | null)[] = [...new Set(legs.map((l) => l.selection))];
  if (outcomes.length === 1 && legs.some((l) => l.side === "lay")) outcomes.push(null);
  return { worst: Math.min(...outcomes.map(settle)), backs, liability };
}

// The month's results the server keeps for the surebets it has forgotten
// (two days after their match): "2026-11", their sum in euros, how many.
export interface MonthResults {
  month: string;
  profit: number;
  count: number;
}

export function readResults(body: unknown): MonthResults | null {
  const r = (body as { results?: unknown } | null)?.results as Record<string, unknown> | undefined;
  if (!r || typeof r.month !== "string" || typeof r.profit !== "number" || typeof r.count !== "number") return null;
  return { month: r.month, profit: r.profit, count: r.count };
}

const BERLIN_MONTH = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit" });
const MONTH_NAME = new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", month: "long" });

// The month's total above "Meine Surebets": the server's results, and the
// surebets still held whose match started this month (Berlin) with a stake on
// each leg ("November: +18,40 € gesichert aus 6 Surebets"). Null with none.
export function monthLabel(results: MonthResults | null, taken: readonly TakenInfo[], now: Date): string | null {
  const month = BERLIN_MONTH.format(now).slice(0, 7);
  let profit = results?.month === month ? results.profit : 0;
  let count = results?.month === month ? results.count : 0;
  for (const item of taken) {
    const start = Date.parse(item.startTime);
    if (!(start <= now.getTime()) || BERLIN_MONTH.format(new Date(start)).slice(0, 7) !== month) continue;
    const result = lockedResult(item.legs, item.stakes);
    if (!result) continue;
    profit += result.worst;
    count += 1;
  }
  if (count === 0) return null;
  const name = MONTH_NAME.format(new Date(`${month}-15T00:00:00Z`));
  const surebets = count === 1 ? "1 Surebet" : `${count} Surebets`;
  return profit >= -0.005
    ? `${name}: +${euros(Math.max(profit, 0))} gesichert aus ${surebets}`
    : `${name}: −${euros(-profit)} aus ${surebets}`;
}

// A total stake split over a taken surebet's legs as the surebets list splits
// it (src/db/surebets.ts): backs in inverse proportion to their prices (a back
// at the exchange net of its commission), so that any of them winning pays
// the same; with a lay, the total is its back's stake and the lay's stake is
// back × price / (lay − commission). Rounded to the euro, as a bookmaker
// expects a stake. Null when the total is not a positive amount or the legs
// are neither all backs nor a back and its lay.
export function splitStakes(legs: readonly TakenLeg[], total: number): number[] | null {
  if (!(total > 0) || legs.length === 0) return null;
  const lays = legs.filter((l) => l.side === "lay");
  if (lays.length > 0) {
    const back = legs.find((l) => l.side === "back");
    if (legs.length !== 2 || lays.length !== 1 || !back || lays[0].price <= EXCHANGE_COMMISSION) return null;
    const lay = Math.round((total * back.price) / (lays[0].price - EXCHANGE_COMMISSION));
    return legs.map((l) => (l.side === "lay" ? lay : Math.round(total)));
  }
  const net = (l: TakenLeg) => (l.source === EXCHANGE ? 1 + (l.price - 1) * (1 - EXCHANGE_COMMISSION) : l.price);
  if (legs.some((l) => net(l) <= 1)) return null;
  const rate = 1 / legs.reduce((sum, l) => sum + 1 / net(l), 0);
  return legs.map((l) => Math.round((total * rate) / net(l)));
}

async function sendStakes(key: string, stakes: (number | null)[]): Promise<boolean> {
  try {
    const res = await fetch("/api/taken-surebets/stakes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, stakes }),
    });
    if (res.status === 401) announceUnauthorized();
    return res.ok;
  } catch {
    return false;
  }
}

// The account's taken surebets, and the ways to change them. A change shows at
// once and is undone if the server refuses it. The dashboard holds one for its
// surebets and "Meine Surebets" together (App); `enabled` false reads nothing,
// for a table given that one.
export function useTakenSurebets(enabled = true): TakenSurebetsState {
  const [taken, setState] = useState<Map<string, TakenInfo>>(() => new Map());
  const [results, setResults] = useState<MonthResults | null>(null);
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
        setResults(readResults(body));
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
      // So are its legs' prices.
      const legs = before?.legs ?? takenLegs(surebet);
      update(key, {
        remind,
        eventId: surebet.eventId,
        startTime: surebet.startTime,
        label,
        remindedAt: before?.remindedAt ?? null,
        payoutRate,
        legs,
        ...(before?.stakes ? { stakes: before.stakes } : {}),
      });
      void send("PUT", { key, eventId: surebet.eventId, startTime: surebet.startTime, label, remind, payoutRate: surebet.payoutRate, legs: takenLegs(surebet) }).then(
        (ok) => {
          if (!ok) update(key, before);
        }
      );
    },
    [update]
  );

  const remove = useCallback(
    (key: string) => {
      const before = taken.get(key);
      update(key, undefined);
      void send("DELETE", { key }).then((ok) => {
        if (!ok) update(key, before);
      });
    },
    [taken, update]
  );

  const setTaken = useCallback(
    (surebet: Surebet, isTaken: boolean) => {
      const key = surebetKey(surebet);
      if (isTaken) {
        save(surebet, hasExchangeLeg(surebet), taken.get(key));
        return;
      }
      remove(key);
    },
    [taken, save, remove]
  );

  const setRemind = useCallback(
    (surebet: Surebet, remind: boolean) => save(surebet, remind, taken.get(surebetKey(surebet))),
    [taken, save]
  );

  const setStakes = useCallback(
    (key: string, stakes: (number | null)[]) => {
      const before = taken.get(key);
      if (!before) return;
      update(key, { ...before, stakes });
      void sendStakes(key, stakes).then((ok) => {
        if (!ok) update(key, before);
      });
    },
    [taken, update]
  );

  return { taken, results, setTaken, setRemind, setStakes, remove };
}
