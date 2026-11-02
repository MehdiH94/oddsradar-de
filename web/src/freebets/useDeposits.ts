import { useCallback, useEffect, useState } from "react";
import { ALL_BOOKMAKERS, BOOKMAKER_BRANDING } from "../bookmakers";
import { amountText, parseAmount } from "./format";
import { fetchDeposits, saveDeposits, type BookmakerId, type MonthDeposits } from "./freebetsApi";

// The bookmakers LUGAS counts: the German-licensed ones (not 20bet).
export const LUGAS_BOOKMAKERS = ALL_BOOKMAKERS.filter((id) => !BOOKMAKER_BRANDING[id]?.unlicensed) as BookmakerId[];

export interface DepositsState {
  status: "loading" | "ready" | "failed";
  // What the server holds: the month, its total and the limit.
  held: MonthDeposits | null;
  texts: Record<string, string>;
  invalid: ReadonlySet<string>;
  saving: boolean;
  saveFailed: boolean;
  setText(bookmaker: BookmakerId, text: string): void;
  // A field left: what it says is saved when it changed.
  commit(): void;
  retry(): void;
}

// An answer the card can show, or null: a month, deposits, a total and a limit.
function checked(answer: unknown): MonthDeposits | null {
  const a = answer as Partial<MonthDeposits> | null;
  return a && typeof a.month === "string" && /^\d{4}-\d{2}$/.test(a.month) && typeof a.deposits === "object" && a.deposits !== null
    && typeof a.total === "number" && typeof a.limit === "number"
    ? (a as MonthDeposits)
    : null;
}

const textsOf = (held: MonthDeposits) => Object.fromEntries(LUGAS_BOOKMAKERS.map((id) => [id, amountText(held.deposits[id])]));

// The account's deposits this month: read once, saved when a field is left
// (not while one holds something that is not an amount).
export function useDeposits(): DepositsState {
  const [status, setStatus] = useState<DepositsState["status"]>("loading");
  const [held, setHeld] = useState<MonthDeposits | null>(null);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [loads, setLoads] = useState(0);

  useEffect(() => {
    let alive = true;
    fetchDeposits()
      .then((raw) => {
        if (!alive) return;
        const answer = checked(raw);
        if (!answer) throw new Error("not deposits");
        setHeld(answer);
        setTexts(textsOf(answer));
        setStatus("ready");
      })
      .catch(() => alive && setStatus("failed"));
    return () => {
      alive = false;
    };
  }, [loads]);

  const invalid = new Set(LUGAS_BOOKMAKERS.filter((id) => parseAmount(texts[id] ?? "") === null));

  const commit = useCallback(() => {
    if (!held) return;
    const deposits: MonthDeposits["deposits"] = {};
    for (const id of LUGAS_BOOKMAKERS) {
      const amount = parseAmount(texts[id] ?? "");
      if (amount === null) return;
      if (amount > 0) deposits[id] = amount;
    }
    if (JSON.stringify(deposits) === JSON.stringify(held.deposits)) return;
    setSaving(true);
    setSaveFailed(false);
    saveDeposits(deposits)
      .then((raw) => {
        const answer = checked(raw);
        if (!answer) throw new Error("not deposits");
        setHeld(answer);
        setTexts(textsOf(answer));
      })
      .catch(() => setSaveFailed(true))
      .finally(() => setSaving(false));
  }, [held, texts]);

  return {
    status,
    held,
    texts,
    invalid,
    saving,
    saveFailed,
    setText: (bookmaker, text) => setTexts((current) => ({ ...current, [bookmaker]: text })),
    commit,
    retry: () => {
      if (status === "failed") {
        setStatus("loading");
        setLoads((n) => n + 1);
      } else commit();
    },
  };
}
