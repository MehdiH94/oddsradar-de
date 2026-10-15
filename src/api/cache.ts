// Answers kept for `ttlMs`: a request computed once serves the same request
// again until it expires. The listing's data only moves with the worker's
// cycles (minutes apart), so a few seconds' staleness costs nothing, while a
// computation that blocks the event loop (node:sqlite is synchronous) is not
// repeated by every visitor and every refresh.
//
// A `ttlMs` of 0 caches nothing. Keys come from the query string, so the
// cache is bounded: past `maxEntries` the expired answers go, then the oldest.
export function ttlCache<T>(ttlMs: number, maxEntries = 100) {
  const entries = new Map<string, { at: number; value: T }>();
  return (key: string, compute: () => T): T => {
    if (ttlMs <= 0) return compute();
    const now = Date.now();
    const hit = entries.get(key);
    if (hit && now - hit.at < ttlMs) return hit.value;
    const value = compute();
    entries.delete(key);
    entries.set(key, { at: Date.now(), value });
    if (entries.size > maxEntries) {
      for (const [k, e] of entries) if (now - e.at >= ttlMs) entries.delete(k);
      // Map iterates in insertion order: the first keys are the oldest.
      for (const k of entries.keys()) {
        if (entries.size <= maxEntries) break;
        entries.delete(k);
      }
    }
    return value;
  };
}

// The same for an answer that is awaited (a calculation in a worker thread): the
// promise is kept as soon as it is made, so that requests arriving while it is
// being computed share it instead of starting their own. A failure is not
// kept: the next request tries again.
export function ttlPromiseCache<T>(ttlMs: number, maxEntries = 200) {
  const entries = new Map<string, { at: number; value: Promise<T> }>();
  return (key: string, compute: () => Promise<T>): Promise<T> => {
    if (ttlMs <= 0) return compute();
    const now = Date.now();
    const hit = entries.get(key);
    if (hit && now - hit.at < ttlMs) return hit.value;
    const entry = { at: now, value: compute() };
    entries.delete(key);
    entries.set(key, entry);
    entry.value.catch(() => {
      if (entries.get(key) === entry) entries.delete(key);
    });
    if (entries.size > maxEntries) {
      for (const [k, e] of entries) if (now - e.at >= ttlMs) entries.delete(k);
      for (const k of entries.keys()) {
        if (entries.size <= maxEntries) break;
        entries.delete(k);
      }
    }
    return entry.value;
  };
}
