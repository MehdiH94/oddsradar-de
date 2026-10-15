import { describe, it, expect, vi, afterEach } from "vitest";
import { ttlCache, ttlPromiseCache } from "../../src/api/cache";

describe("ttlCache", () => {
  afterEach(() => vi.useRealTimers());

  it("computes once per key within the ttl, and again after it", () => {
    vi.useFakeTimers();
    const get = ttlCache<number>(1000);
    let n = 0;
    expect(get("a", () => ++n)).toBe(1);
    expect(get("a", () => ++n)).toBe(1);
    expect(get("b", () => ++n)).toBe(2);
    vi.advanceTimersByTime(1000);
    expect(get("a", () => ++n)).toBe(3);
  });

  it("keeps nothing with a ttl of 0", () => {
    const get = ttlCache<number>(0);
    let n = 0;
    expect(get("a", () => ++n)).toBe(1);
    expect(get("a", () => ++n)).toBe(2);
  });

  it("stays within maxEntries, dropping the oldest", () => {
    const get = ttlCache<number>(60_000, 2);
    let n = 0;
    get("a", () => ++n);
    get("b", () => ++n);
    get("c", () => ++n);
    expect(get("c", () => ++n)).toBe(3);
    expect(get("a", () => ++n)).toBe(4);
  });
});

describe("ttlPromiseCache", () => {
  afterEach(() => vi.useRealTimers());

  it("shares one computation among requests that arrive while it runs, and keeps its answer for the ttl", async () => {
    vi.useFakeTimers();
    const get = ttlPromiseCache<number>(1000);
    let runs = 0;
    const slow = () => new Promise<number>((resolve) => setTimeout(() => resolve(++runs), 50));
    const both = [get("a", slow), get("a", slow)];
    vi.advanceTimersByTime(50);
    expect(await Promise.all(both)).toEqual([1, 1]);
    expect(await get("a", slow)).toBe(1);
    vi.advanceTimersByTime(1000);
    const again = get("a", slow);
    vi.advanceTimersByTime(50);
    expect(await again).toBe(2);
  });

  it("does not keep a failure", async () => {
    const get = ttlPromiseCache<number>(60_000);
    await expect(get("a", () => Promise.reject(new Error("busy")))).rejects.toThrow("busy");
    expect(await get("a", () => Promise.resolve(7))).toBe(7);
    // The answer that followed is the one kept.
    expect(await get("a", () => Promise.resolve(8))).toBe(7);
  });

  it("keeps nothing with a ttl of 0, and stays within maxEntries", async () => {
    const none = ttlPromiseCache<number>(0);
    let n = 0;
    expect(await none("a", async () => ++n)).toBe(1);
    expect(await none("a", async () => ++n)).toBe(2);
    const get = ttlPromiseCache<number>(60_000, 2);
    for (const key of ["a", "b", "c"]) await get(key, async () => ++n);
    expect(await get("c", async () => ++n)).toBe(5);
    expect(await get("a", async () => ++n)).toBe(6);
  });
});
