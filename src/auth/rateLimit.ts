// A fixed-window counter per key, in memory: enough while one web process
// serves the site (a second one would count on its own). Keys are dropped
// when their window ends.
export interface RateLimiter {
  // Counts one hit on `key`; the seconds to wait when over the limit, else 0.
  hit(key: string, max: number, windowMs: number): number;
  reset(key: string): void;
}

export function createRateLimiter(now: () => number = Date.now): RateLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return {
    hit(key, max, windowMs) {
      const t = now();
      if (windows.size > 10_000) {
        for (const [k, w] of windows) if (w.resetAt <= t) windows.delete(k);
      }
      let w = windows.get(key);
      if (!w || w.resetAt <= t) {
        w = { count: 0, resetAt: t + windowMs };
        windows.set(key, w);
      }
      w.count += 1;
      return w.count > max ? Math.ceil((w.resetAt - t) / 1000) : 0;
    },
    reset(key) {
      windows.delete(key);
    },
  };
}
