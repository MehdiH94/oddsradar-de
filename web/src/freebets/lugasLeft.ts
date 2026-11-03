import { useEffect, useState } from "react";

// What is left of this month's LUGAS limit, once the account wrote down a
// deposit (src/deposits/deposits.ts): the navigation's "Freebets" entry
// says it. Null before, without deposits, or on any failure: a plain fetch,
// so that a signed-out answer never signs the page out.
export function lugasLeftOf(body: unknown): number | null {
  const b = body as { total?: unknown; limit?: unknown } | null;
  if (!b || typeof b.total !== "number" || typeof b.limit !== "number" || b.total <= 0) return null;
  return Math.max(0, b.limit - b.total);
}

export function useLugasLeft(enabled: boolean): number | null {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetch("/api/deposits")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (alive) setLeft(lugasLeftOf(body));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [enabled]);
  return left;
}
