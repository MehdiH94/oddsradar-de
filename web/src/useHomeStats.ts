import { useEffect, useState } from "react";

export interface HomeStats {
  loading: boolean;
  // Each figure is null when the request failed.
  matches: number | null;
  sports: string[] | null;
  updatedAt: Date | null;
}

// What the home says about the product, from the one public answer
// (/api/public/home: totals only -- the value bets are for accounts, so the
// home shows a made-up example of one). A request that fails leaves its figure null; the
// home never waits on them to show its text.
export function useHomeStats(): HomeStats {
  const [stats, setStats] = useState<HomeStats>({
    loading: true,
    matches: null,
    sports: null,
    updatedAt: null,
  });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/public/home")
      .then((res) => {
        if (!res.ok) throw new Error(`GET /api/public/home failed: ${res.status}`);
        return res.json() as Promise<{ matches: number; sports: string[] }>;
      })
      .then(
        (home) => !cancelled && setStats({ loading: false, matches: home.matches, sports: home.sports, updatedAt: new Date() }),
        (err) => {
          if (cancelled) return;
          console.error(err);
          setStats((previous) => ({ ...previous, loading: false }));
        }
      );
    return () => {
      cancelled = true;
    };
  }, []);

  return stats;
}
