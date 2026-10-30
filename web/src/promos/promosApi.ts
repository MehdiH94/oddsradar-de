import { useCallback, useEffect, useState } from "react";
import { announceUnauthorized } from "../auth/session";
import { BOOKMAKER_BRANDING } from "../bookmakers";

// A promotion as /api/promos gives it (src/auth/promos.ts): one the account
// wrote down (`mine`), or one the site found. `takenAt` is when the account
// marked it taken, null while it has not.
export interface Promo {
  id: number;
  source: "manual" | "site" | "telegram" | "email";
  bookmaker: string;
  title: string;
  details: string;
  url: string | null;
  endsAt: string | null;
  foundAt: string;
  mine: boolean;
  takenAt: string | null;
}

export interface NewPromo {
  bookmaker: string;
  title: string;
  details: string;
  url: string | null;
  endsAt: string | null;
}

export function readPromos(body: unknown): Promo[] {
  const list = (body as { promos?: unknown } | null)?.promos;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (p): p is Promo => typeof p === "object" && p !== null && typeof (p as Promo).id === "number" && typeof (p as Promo).title === "string"
  );
}

// The bookmaker a promo is filed under: one the site knows, by its id or its
// name in any case ("winamax", "Winamax"), gets its name and its id (for its
// icon); any other (a crypto site) stays as it was written.
export function bookmakerOf(written: string): { key: string; name: string; id: string | null } {
  const trimmed = written.trim();
  const lower = trimmed.toLowerCase();
  for (const [id, brand] of Object.entries(BOOKMAKER_BRANDING)) {
    if (brand && (id === lower || brand.name.toLowerCase() === lower)) return { key: id, name: brand.name, id };
  }
  return { key: lower, name: trimmed, id: null };
}

// The promos by bookmaker, in the order of the list (the server's: the open
// ones first, soonest end first), so that the bookmaker with the most urgent
// promo comes first.
export function groupByBookmaker(promos: readonly Promo[]): Array<{ key: string; name: string; id: string | null; promos: Promo[] }> {
  const groups = new Map<string, { key: string; name: string; id: string | null; promos: Promo[] }>();
  for (const promo of promos) {
    const bookmaker = bookmakerOf(promo.bookmaker);
    const group = groups.get(bookmaker.key) ?? { ...bookmaker, promos: [] };
    group.promos.push(promo);
    groups.set(bookmaker.key, group);
  }
  return [...groups.values()];
}

const END_FORMAT = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

// "Endet Mo., 20.10., 23:59", "Abgelaufen", or nothing for a promo without an end.
export function endLabel(endsAt: string | null, now = new Date()): string | null {
  if (!endsAt) return null;
  const end = new Date(endsAt);
  if (Number.isNaN(end.getTime())) return null;
  return end.getTime() < now.getTime() ? "Abgelaufen" : `Endet ${END_FORMAT.format(end)}`;
}

// A promotion the site found itself (not one written down by hand) within
// this long is marked "Neu", so that what came since the last visit stands out.
export const NEW_FOR_MS = 24 * 60 * 60 * 1000;

export function isNew(promo: Pick<Promo, "source" | "foundAt">, now = new Date()): boolean {
  if (promo.source !== "site") return false;
  const found = Date.parse(promo.foundAt);
  return !Number.isNaN(found) && now.getTime() - found < NEW_FOR_MS;
}

// How many open promotions (not marked taken) are new: the count on the
// navigation's "Promos" entry.
export function countNew(promos: readonly Promo[], now = new Date()): number {
  return promos.filter((p) => !p.takenAt && isNew(p, now)).length;
}

// That count for the pages other than Promos, read once when the navigation
// shows (`enabled`). Quiet: a failed read is no count, and a lapsed session is
// left to the page's own requests to announce.
export function useNewPromosCount(enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetch("/api/promos")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (alive) setCount(countNew(readPromos(body)));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [enabled]);
  return count;
}

// The end of the chosen day, where the visitor is: a promo "until the 20th"
// lasts the whole 20th.
export function endOfDay(day: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const end = new Date(`${day}T23:59:00`);
  return Number.isNaN(end.getTime()) ? null : end.toISOString();
}

async function send(path: string, method: "POST" | "PUT" | "DELETE", body: unknown): Promise<Response | null> {
  try {
    const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.status === 401) announceUnauthorized();
    return res;
  } catch {
    return null;
  }
}

export interface PromosState {
  status: "loading" | "ready" | "error";
  promos: Promo[];
  // The e-mail the day before an open promo ends (src/auth/promoReminders.ts).
  remind: boolean;
  setRemind: (remind: boolean) => void;
  updatedAt: Date | null;
  reload: () => void;
  // Null once added, else the message to show.
  add: (promo: NewPromo) => Promise<string | null>;
  setTaken: (id: number, taken: boolean) => void;
  remove: (id: number) => void;
}

// The account's promos, and the ways to change them. A mark or a removal shows
// at once and is undone if the server refuses it.
export function usePromos(): PromosState {
  const [status, setStatus] = useState<PromosState["status"]>("loading");
  const [promos, setPromos] = useState<Promo[]>([]);
  const [remind, setRemindState] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/promos")
      .then((res) => {
        if (res.status === 401) announceUnauthorized();
        return res.ok ? res.json() : Promise.reject(new Error(String(res.status)));
      })
      .then((body) => {
        if (!alive) return;
        setPromos(readPromos(body));
        setRemindState((body as { remind?: unknown } | null)?.remind !== false);
        setUpdatedAt(new Date());
        setStatus("ready");
      })
      .catch(() => {
        if (alive) setStatus((current) => (current === "ready" ? current : "error"));
      });
    return () => {
      alive = false;
    };
  }, [version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  const add = useCallback(
    async (promo: NewPromo) => {
      const res = await send("/api/promos", "POST", promo);
      if (res?.ok) {
        reload();
        return null;
      }
      const body = (await res?.json().catch(() => null)) as { message?: unknown } | null;
      return typeof body?.message === "string" ? body.message : "Die Aktion konnte nicht gespeichert werden. Bitte versuch es noch einmal.";
    },
    [reload]
  );

  const setTaken = useCallback((id: number, taken: boolean) => {
    let before: string | null = null;
    setPromos((current) =>
      current.map((p) => {
        if (p.id !== id) return p;
        before = p.takenAt;
        return { ...p, takenAt: taken ? new Date().toISOString() : null };
      })
    );
    void send(`/api/promos/${id}/taken`, "PUT", { taken }).then((res) => {
      if (!res?.ok) setPromos((current) => current.map((p) => (p.id === id ? { ...p, takenAt: before } : p)));
    });
  }, []);

  const remove = useCallback(
    (id: number) => {
      setPromos((current) => current.filter((p) => p.id !== id));
      void send(`/api/promos/${id}`, "DELETE", {}).then((res) => {
        if (!res?.ok) reload();
      });
    },
    [reload]
  );

  const setRemind = useCallback((next: boolean) => {
    setRemindState(next);
    void send("/api/promos/settings", "PUT", { remind: next }).then((res) => {
      if (!res?.ok) setRemindState(!next);
    });
  }, []);

  return { status, promos, remind, setRemind, updatedAt, reload, add, setTaken, remove };
}
