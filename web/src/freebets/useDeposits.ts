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
  // The account's own limit as typed, and whether it is not an amount.
  limitText: string;
  limitInvalid: boolean;
  setLimitText(text: string): void;
  // The limit field left: an amount saved as the account's own, empty back to the default.
  commitLimit(): void;
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
  const [limitText, setLimitText] = useState("");

  useEffect(() => {
    let alive = true;
    fetchDeposits()
      .then((raw) => {
        if (!alive) return;
        const answer = checked(raw);
        if (!answer) throw new Error("not deposits");
        setHeld(answer);
        setTexts(textsOf(answer));
        setLimitText(answer.personalLimit ? amountText(answer.limit) : "");
        setStatus("ready");
      })
      .catch(() => alive && setStatus("failed"));
    return () => {
      alive = false;
    };
  }, [loads]);

  const invalid = new Set(LUGAS_BOOKMAKERS.filter((id) => parseAmount(texts[id] ?? "") === null));

  const depositsTyped = useCallback((): MonthDeposits["deposits"] | null => {
    const deposits: MonthDeposits["deposits"] = {};
    for (const id of LUGAS_BOOKMAKERS) {
      const amount = parseAmount(texts[id] ?? "");
      if (amount === null) return null;
      if (amount > 0) deposits[id] = amount;
    }
    return deposits;
  }, [texts]);

  const send = useCallback(
    (deposits: MonthDeposits["deposits"], limit?: number | null) => {
      setSaving(true);
      setSaveFailed(false);
      saveDeposits(deposits, limit)
        .then((raw) => {
          const answer = checked(raw);
          if (!answer) throw new Error("not deposits");
          setHeld(answer);
          setTexts(textsOf(answer));
          setLimitText(answer.personalLimit ? amountText(answer.limit) : "");
        })
        .catch(() => setSaveFailed(true))
        .finally(() => setSaving(false));
    },
    []
  );

  const commitLimit = useCallback(() => {
    if (!held) return;
    const deposits = depositsTyped();
    const amount = parseAmount(limitText);
    if (deposits === null || amount === null) return;
    const limit = amount > 0 ? amount : null;
    if (limit === (held.personalLimit ? held.limit : null)) return;
    send(deposits, limit);
  }, [held, depositsTyped, limitText, send]);

  const commit = useCallback(() => {
    if (!held) return;
    const deposits = depositsTyped();
    if (deposits === null) return;
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
  }, [held, depositsTyped]);

  return {
    status,
    held,
    texts,
    invalid,
    saving,
    saveFailed,
    setText: (bookmaker, text) => setTexts((current) => ({ ...current, [bookmaker]: text })),
    commit,
    limitText,
    limitInvalid: parseAmount(limitText) === null,
    setLimitText,
    commitLimit,
    retry: () => {
      if (status === "failed") {
        setStatus("loading");
        setLoads((n) => n + 1);
      } else commit();
    },
  };
}
