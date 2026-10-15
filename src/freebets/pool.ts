import path from "node:path";
import { Worker } from "node:worker_threads";
import { runJob } from "./compute";
import { ComputeJob, ComputeResult } from "./jobs";

// The calculation of the Freebets page takes from a few milliseconds to a few
// hundred (three-match combos among a thousand matches), and node:sqlite and
// Express share one thread: it runs in a worker thread, one job at a time,
// the others waiting their turn.

export type ComputeErrorCode =
  // Too many jobs are waiting: the caller should come back later.
  | "busy"
  // The job took longer than the pool allows: its worker was stopped.
  | "timeout"
  // The worker died while running it.
  | "crashed"
  // The pool was closed.
  | "closed"
  // The engine threw.
  | "failed";

export class ComputeError extends Error {
  constructor(
    readonly code: ComputeErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ComputeError";
  }
}

export interface ComputePool {
  run(job: ComputeJob): Promise<ComputeResult>;
  // Stops the worker and refuses what is waiting.
  close(): Promise<void>;
}

// What the pool uses of a worker thread (a test passes its own).
export interface WorkerLike {
  postMessage(message: unknown): void;
  on(event: "message" | "error" | "exit", listener: (value: any) => void): unknown;
  terminate(): Promise<unknown>;
  unref(): void;
}

export interface WorkerPoolOptions {
  // How long one job may run before its worker is stopped (default 10 s: the
  // engine's own deadline is 1.5 s, this is for what goes wrong).
  timeoutMs?: number;
  // Jobs that may wait while one runs; the next one is refused as "busy" (default 16).
  maxQueue?: number;
  spawn?: () => WorkerLike;
}

// Compiled (dist/, how the site runs), worker.js sits beside this file. Under
// ts-node (npm run api) or vitest the files are TypeScript, which a worker
// cannot load by itself: it registers ts-node first, without type checking.
function spawnWorker(): WorkerLike {
  const script = path.join(__dirname, "worker");
  if (path.extname(__filename) === ".js") return new Worker(`${script}.js`);
  const register = require.resolve("ts-node/register/transpile-only");
  return new Worker(`require(${JSON.stringify(register)}); require(${JSON.stringify(`${script}.ts`)});`, { eval: true });
}

interface Pending {
  id: number;
  job: ComputeJob;
  resolve: (result: ComputeResult) => void;
  reject: (err: ComputeError) => void;
  timer?: NodeJS.Timeout;
}

// One worker thread, started by the first job and again after it dies or is
// stopped, and a queue. The worker is unref'd: an idle one never keeps the
// process alive.
export function createWorkerPool({ timeoutMs = 10_000, maxQueue = 16, spawn = spawnWorker }: WorkerPoolOptions = {}): ComputePool {
  let worker: WorkerLike | null = null;
  let current: Pending | null = null;
  const queue: Pending[] = [];
  let nextId = 1;
  let closed = false;

  function settle(pending: Pending, outcome: { result: ComputeResult } | { error: ComputeError }): void {
    clearTimeout(pending.timer);
    if (current === pending) current = null;
    if ("result" in outcome) pending.resolve(outcome.result);
    else pending.reject(outcome.error);
    pump();
  }

  // The worker is gone (it died, or was stopped): what it was running fails.
  function lose(gone: WorkerLike, error: ComputeError): void {
    if (worker !== gone) return;
    worker = null;
    if (current) settle(current, { error });
  }

  function start(): WorkerLike {
    const w = spawn();
    w.unref();
    w.on("message", (message: { id: number; ok: boolean; result?: ComputeResult; error?: string }) => {
      if (worker !== w || !current || current.id !== message.id) return;
      if (message.ok) settle(current, { result: message.result! });
      else settle(current, { error: new ComputeError("failed", message.error ?? "the calculation failed") });
    });
    w.on("error", (err: Error) => lose(w, new ComputeError("crashed", `the calculation's worker failed: ${err.message}`)));
    w.on("exit", () => lose(w, new ComputeError("crashed", "the calculation's worker stopped")));
    return w;
  }

  function pump(): void {
    if (current || closed) return;
    const next = queue.shift();
    if (!next) return;
    current = next;
    try {
      worker ??= start();
    } catch (err) {
      settle(next, { error: new ComputeError("crashed", `the calculation's worker did not start: ${err instanceof Error ? err.message : String(err)}`) });
      return;
    }
    const running = worker;
    next.timer = setTimeout(() => {
      // Stuck, or far too slow: the worker is stopped, and the next job starts a fresh one.
      if (worker === running) worker = null;
      void running.terminate();
      settle(next, { error: new ComputeError("timeout", "the calculation took too long") });
    }, timeoutMs);
    running.postMessage({ id: next.id, job: next.job });
  }

  return {
    run(job) {
      if (closed) return Promise.reject(new ComputeError("closed", "the calculation's pool is closed"));
      if (queue.length >= maxQueue) return Promise.reject(new ComputeError("busy", "too many calculations are waiting"));
      return new Promise((resolve, reject) => {
        queue.push({ id: nextId++, job, resolve, reject });
        pump();
      });
    },
    async close() {
      closed = true;
      const gone = worker;
      worker = null;
      const error = new ComputeError("closed", "the calculation's pool is closed");
      if (current) settle(current, { error });
      for (const waiting of queue.splice(0)) waiting.reject(error);
      await gone?.terminate();
    },
  };
}

// No thread: the job runs where it is asked (the tests', and the default of a
// server that is not given a pool). A job that throws fails as the worker's would.
export function createInlinePool(): ComputePool {
  return {
    async run(job) {
      try {
        return runJob(job);
      } catch (err) {
        throw new ComputeError("failed", err instanceof Error ? err.message : String(err));
      }
    },
    async close() {},
  };
}
