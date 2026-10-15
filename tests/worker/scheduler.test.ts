import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startScheduler } from "../../src/worker/scheduler";

describe("startScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs immediately, then again on each interval, and stops on demand", async () => {
    const run = vi.fn().mockResolvedValue(undefined);

    const handle = startScheduler(1, run);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(2);

    handle.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("logs and continues if a cycle throws", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const run = vi.fn().mockRejectedValue(new Error("cycle failed"));

    const handle = startScheduler(1, run);
    await vi.waitFor(() => expect(consoleErrorSpy).toHaveBeenCalledOnce());

    handle.stop();
    consoleErrorSpy.mockRestore();
  });

  it("does not start a new cycle while the previous one is still running", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    let resolveFirst: () => void = () => {};
    const firstCycle = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const run = vi.fn().mockReturnValue(firstCycle);

    const handle = startScheduler(1, run);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));

    // Three intervals elapse while the first cycle is still in flight. Without
    // the guard this would launch three more cycles -- and, in production,
    // three more sets of bookmaker API connections on top of the ones still open.
    await vi.advanceTimersByTimeAsync(180_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(3);

    // Once it finishes, the next tick proceeds normally.
    resolveFirst();
    await firstCycle;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(2);

    handle.stop();
    consoleWarnSpy.mockRestore();
  });

  it("releases the guard after a failing cycle so the scheduler does not wedge", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const run = vi.fn().mockRejectedValue(new Error("cycle failed"));

    const handle = startScheduler(1, run);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(2);

    handle.stop();
    consoleErrorSpy.mockRestore();
  });
});
