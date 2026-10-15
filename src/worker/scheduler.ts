export function startScheduler(intervalMinutes: number, run: () => Promise<void>): { stop: () => void } {
  let stopped = false;
  // Guards against a new interval firing while the previous cycle is still in
  // flight. A cycle can legitimately overrun its interval -- Winamax's sports
  // are requested one after another, each allowed up to its own timeout -- and
  // overlapping cycles would stack concurrent connections to the bookmakers'
  // APIs and concurrent writers on the same SQLite file with no ceiling.
  // Skipping is the right response rather than queueing: the next tick will
  // fetch fresher odds than a backlogged one would anyway.
  let running = false;

  const tick = async () => {
    if (stopped) return;
    if (running) {
      // Logged distinctly from a cycle failure: a cycle that regularly overruns
      // its interval is a capacity signal, not an error.
      console.warn("[scheduler] skipping tick, previous cycle still running");
      return;
    }

    running = true;
    try {
      await run();
    } catch (err) {
      console.error("[scheduler] cycle failed:", err);
    } finally {
      running = false;
    }
  };

  void tick();
  const handle = setInterval(tick, intervalMinutes * 60 * 1000);

  return {
    stop: () => {
      stopped = true;
      clearInterval(handle);
    },
  };
}
