import { useCallback, useEffect, useMemo, useState } from "react";
import { ALL_BOOKMAKERS } from "../bookmakers";
import { amountText, parseAmount } from "./format";
import { fetchWallet, saveWallet, type BookmakerId, type Wallet } from "./freebetsApi";

export const SAVE_DELAY_MS = 800;

// saved: the server holds what is typed; pending/saving: it is on its way; failed: the server did not take it;
// invalid: a field holds something that is not an amount, nothing is sent.
export type SaveState = "saved" | "pending" | "saving" | "failed" | "invalid";

export interface WalletState {
  // loading: the account's wallet is on its way; failed: it never came.
  status: "loading" | "ready" | "failed";
  // What each field holds, as typed.
  texts: Record<BookmakerId, string>;
  // The bookmakers whose field is not an amount.
  invalid: ReadonlySet<BookmakerId>;
  // The amounts typed, in FB (what is not an amount counts for nothing), and their total.
  wallet: Wallet;
  total: number;
  save: SaveState;
  // Counts the wallets the server holds: a new one when it came, and when it was saved. The results are asked
  // for again then, since the server converts what it holds.
  version: number;
  setText(bookmaker: BookmakerId, text: string): void;
  // A field left: its text becomes the amount it makes ("12.50" -> "12,5").
  tidy(bookmaker: BookmakerId): void;
  retry(): void;
}

const emptyTexts = () => Object.fromEntries(ALL_BOOKMAKERS.map((id) => [id, ""])) as Record<BookmakerId, string>;

function amountsOf(texts: Record<BookmakerId, string>): { wallet: Wallet; invalid: Set<BookmakerId> } {
  const wallet: Wallet = {};
  const invalid = new Set<BookmakerId>();
  for (const id of ALL_BOOKMAKERS) {
    const amount = parseAmount(texts[id]);
    if (amount === null) invalid.add(id);
    else if (amount > 0) wallet[id] = amount;
  }
  return { wallet, invalid };
}

// The account's freebets: read once, then saved a moment after the last change (not while a field holds
// something that is not an amount). A save that fails is kept to try again.
export function useWallet(): WalletState {
  const [status, setStatus] = useState<WalletState["status"]>("loading");
  const [texts, setTexts] = useState(emptyTexts);
  // The wallet the server holds, by value; null until it came.
  const [held, setHeld] = useState<string | null>(null);
  // The save of the amounts typed that is on its way or failed, and the count of retries it was made at.
  const [attempt, setAttempt] = useState<{ key: string; phase: "saving" | "failed"; sends: number } | null>(null);
  const [version, setVersion] = useState(0);
  // Asking the server for the wallet again, and sending it again.
  const [loads, setLoads] = useState(0);
  const [sends, setSends] = useState(0);

  const { wallet, invalid } = useMemo(() => amountsOf(texts), [texts]);
  const key = JSON.stringify(wallet);

  useEffect(() => {
    let cancelled = false;
    fetchWallet()
      .then((current) => {
        if (cancelled) return;
        setHeld(JSON.stringify(current));
        setTexts(Object.fromEntries(ALL_BOOKMAKERS.map((id) => [id, amountText(current[id])])) as Record<BookmakerId, string>);
        setStatus("ready");
        setVersion((v) => v + 1);
      })
      .catch(() => !cancelled && setStatus("failed"));
    return () => {
      cancelled = true;
    };
  }, [loads]);

  const failedHere = attempt?.key === key && attempt.phase === "failed" && attempt.sends === sends;
  useEffect(() => {
    if (status !== "ready" || held === null || invalid.size > 0 || key === held || failedHere) return;
    let cancelled = false;
    const timeout = setTimeout(() => {
      setAttempt({ key, phase: "saving", sends });
      saveWallet(JSON.parse(key) as Wallet)
        .then((current) => {
          // Whatever has been typed since, this is what the server holds now: the effect then compares the two.
          setHeld(JSON.stringify(current));
          setVersion((v) => v + 1);
        })
        .catch(() => !cancelled && setAttempt({ key, phase: "failed", sends }));
    }, SAVE_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [status, held, key, invalid.size, sends, failedHere]);

  let save: SaveState = "saved";
  if (status === "ready" && held !== null) {
    if (invalid.size > 0) save = "invalid";
    else if (key !== held) save = attempt?.key === key ? attempt.phase : "pending";
  }

  const setText = useCallback((bookmaker: BookmakerId, text: string) => setTexts((current) => ({ ...current, [bookmaker]: text })), []);
  const tidy = useCallback(
    (bookmaker: BookmakerId) =>
      setTexts((current) => {
        const amount = parseAmount(current[bookmaker]);
        return amount === null ? current : { ...current, [bookmaker]: amountText(amount) };
      }),
    []
  );
  const retry = useCallback(() => (status === "failed" ? setLoads((n) => n + 1) : setSends((n) => n + 1)), [status]);

  return { status, texts, invalid, wallet, total: Math.round(Object.values(wallet).reduce((s, v) => s + (v ?? 0), 0) * 100) / 100, save, version, setText, tidy, retry };
}
