import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { runJob } from "../../src/freebets/compute";
import { ComputeJob } from "../../src/freebets/jobs";
import { ComputeError, createInlinePool, createWorkerPool, WorkerLike } from "../../src/freebets/pool";
import { genMatches, genWallet, marginsFor } from "./engine/helpers";

const exchangeJob = (fb = 10): ComputeJob => ({
  kind: "exchange",
  items: [
    { id: "a", matchId: "m1", back: 3, lay: 3.1, laySize: 50 },
    { id: "b", matchId: "m2", back: 2.5, lay: 2.55, laySize: 8 },
  ],
  fb,
  commission: 0.03,
});

const combosJob = (): ComputeJob => ({ kind: "combos", matches: genMatches(30, marginsFor(4, 9), 9, { coverage: 1 }), fb: genWallet(4, 9), size: 2 });

// The plans and the chain, without the stats' timings.
const content = (result: Awaited<ReturnType<ReturnType<typeof createInlinePool>["run"]>>) =>
  result.kind === "combos" ? { plans: result.plans, combos: result.stats.combos, solved: result.stats.solved } : result.result;

describe("the worker thread", () => {
  it("answers as the engine does, jobs of both kinds, one after the other", async () => {
    const pool = createWorkerPool();
    try {
      for (const job of [combosJob(), exchangeJob(), combosJob(), exchangeJob(25)]) {
        expect(content(await pool.run(job))).toEqual(content(runJob(job)));
      }
      // Sent together, they come back each with its own answer.
      const answers = await Promise.all([exchangeJob(5), exchangeJob(15), exchangeJob(30)].map((job) => pool.run(job)));
      expect(answers.map((a) => (a.kind === "exchange" ? a.result.converted : -1))).toEqual([5, 15, expect.closeTo(30, 6)]);
    } finally {
      await pool.close();
    }
  }, 30_000);

  it("fails a job the engine refuses, and goes on with the next", async () => {
    const pool = createWorkerPool();
    try {
      const bad = { kind: "exchange", items: [], fb: 10, commission: 2 } as ComputeJob;
      await expect(pool.run(bad)).rejects.toMatchObject({ name: "ComputeError", code: "failed", message: expect.stringContaining("commission") });
      expect(content(await pool.run(exchangeJob()))).toEqual(content(runJob(exchangeJob())));
    } finally {
      await pool.close();
    }
  }, 30_000);

  it("stops with the pool: nothing is left running", async () => {
    const pool = createWorkerPool();
    await pool.run(exchangeJob());
    await pool.close();
    await expect(pool.run(exchangeJob())).rejects.toMatchObject({ code: "closed" });
  }, 30_000);
});

// A worker thread under the test's control.
class FakeWorker extends EventEmitter implements WorkerLike {
  posted: Array<{ id: number; job: ComputeJob }> = [];
  terminated = false;
  unrefd = false;
  postMessage(message: unknown) {
    this.posted.push(message as { id: number; job: ComputeJob });
  }
  async terminate() {
    this.terminated = true;
    this.emit("exit", 1);
    return 1;
  }
  unref() {
    this.unrefd = true;
  }
  answer(id: number, result: unknown = { kind: "exchange", result: { steps: [], converted: id, leftover: 0, cash: 0, liability: 0, ignored: 0, nodes: 0 } }) {
    this.emit("message", { id, ok: true, result });
  }
}

function fakePool(options: { timeoutMs?: number; maxQueue?: number } = {}) {
  const workers: FakeWorker[] = [];
  const pool = createWorkerPool({ ...options, spawn: () => workers[workers.push(new FakeWorker()) - 1] });
  return { pool, workers };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const converted = (answer: Awaited<ReturnType<ReturnType<typeof fakePool>["pool"]["run"]>>) => (answer.kind === "exchange" ? answer.result.converted : -1);

describe("the queue", () => {
  it("starts no worker until a job comes, and then one for all", async () => {
    const { pool, workers } = fakePool();
    expect(workers).toHaveLength(0);
    const first = pool.run(exchangeJob());
    await tick();
    expect(workers).toHaveLength(1);
    // An idle worker never keeps the process alive.
    expect(workers[0].unrefd).toBe(true);
    workers[0].answer(1);
    await first;
    const second = pool.run(exchangeJob());
    await tick();
    expect(workers).toHaveLength(1);
    workers[0].answer(2);
    expect(converted(await second)).toBe(2);
    await pool.close();
  });

  it("runs one job at a time, in the order they came", async () => {
    const { pool, workers } = fakePool();
    const answers = [1, 2, 3].map(() => pool.run(exchangeJob()));
    await tick();
    expect(workers[0].posted.map((m) => m.id)).toEqual([1]);
    workers[0].answer(1);
    await tick();
    expect(workers[0].posted.map((m) => m.id)).toEqual([1, 2]);
    workers[0].answer(2);
    await tick();
    workers[0].answer(3);
    expect((await Promise.all(answers)).map(converted)).toEqual([1, 2, 3]);
    await pool.close();
  });

  it("refuses a job as busy once the queue is full, and takes jobs again as it empties", async () => {
    const { pool, workers } = fakePool({ maxQueue: 2 });
    const kept = [pool.run(exchangeJob()), pool.run(exchangeJob()), pool.run(exchangeJob())];
    await expect(pool.run(exchangeJob())).rejects.toMatchObject({ code: "busy" });
    await tick();
    workers[0].answer(1);
    await tick();
    // One place is free again.
    const again = pool.run(exchangeJob());
    await expect(pool.run(exchangeJob())).rejects.toBeInstanceOf(ComputeError);
    workers[0].answer(2);
    await tick();
    workers[0].answer(3);
    await tick();
    workers[0].answer(4);
    expect((await Promise.all([...kept, again])).map(converted)).toEqual([1, 2, 3, 4]);
    await pool.close();
  });

  it("ignores an answer that is not its current job's", async () => {
    const { pool, workers } = fakePool();
    const job = pool.run(exchangeJob());
    await tick();
    workers[0].answer(99);
    workers[0].answer(1);
    expect(converted(await job)).toBe(1);
    await pool.close();
  });

  it("fails a job the engine refused, and keeps its worker", async () => {
    const { pool, workers } = fakePool();
    const job = pool.run(exchangeJob());
    await tick();
    workers[0].emit("message", { id: 1, ok: false, error: "nope" });
    await expect(job).rejects.toMatchObject({ code: "failed", message: "nope" });
    const next = pool.run(exchangeJob());
    await tick();
    expect(workers).toHaveLength(1);
    workers[0].answer(2);
    await next;
    await pool.close();
  });
});

describe("a worker that fails", () => {
  it("stops a job that takes too long, and runs the next on a fresh worker", async () => {
    const { pool, workers } = fakePool({ timeoutMs: 20 });
    const slow = pool.run(exchangeJob());
    const next = pool.run(exchangeJob());
    await expect(slow).rejects.toMatchObject({ code: "timeout" });
    expect(workers[0].terminated).toBe(true);
    await tick();
    expect(workers).toHaveLength(2);
    // The old worker's late answer reaches no one.
    workers[0].answer(1);
    workers[1].answer(2);
    expect(converted(await next)).toBe(2);
    await pool.close();
  });

  it("fails the running job when the worker errors or exits, and starts another for the next", async () => {
    const { pool, workers } = fakePool();
    const first = pool.run(exchangeJob());
    const second = pool.run(exchangeJob());
    await tick();
    workers[0].emit("error", new Error("out of memory"));
    await expect(first).rejects.toMatchObject({ code: "crashed", message: expect.stringContaining("out of memory") });
    await tick();
    expect(workers).toHaveLength(2);
    workers[1].emit("exit", 1);
    await expect(second).rejects.toMatchObject({ code: "crashed" });
    const third = pool.run(exchangeJob());
    await tick();
    expect(workers).toHaveLength(3);
    workers[2].answer(3);
    expect(converted(await third)).toBe(3);
    await pool.close();
  });

  it("fails a job when no worker can be started, and goes on", async () => {
    let attempts = 0;
    const worker = new FakeWorker();
    const pool = createWorkerPool({
      spawn: () => {
        if (++attempts === 1) throw new Error("no thread");
        return worker;
      },
    });
    const first = pool.run(exchangeJob());
    const second = pool.run(exchangeJob());
    await expect(first).rejects.toMatchObject({ code: "crashed", message: expect.stringContaining("no thread") });
    await tick();
    worker.answer(2);
    expect(converted(await second)).toBe(2);
    await pool.close();
  });
});

describe("closing the pool", () => {
  it("refuses the running job and the waiting ones, stops the worker, and takes no more", async () => {
    const { pool, workers } = fakePool();
    const running = pool.run(exchangeJob());
    const waiting = pool.run(exchangeJob());
    await tick();
    await pool.close();
    await expect(running).rejects.toMatchObject({ code: "closed" });
    await expect(waiting).rejects.toMatchObject({ code: "closed" });
    expect(workers[0].terminated).toBe(true);
    await expect(pool.run(exchangeJob())).rejects.toMatchObject({ code: "closed" });
    // Twice is fine.
    await pool.close();
  });
});

describe("the pool with no thread", () => {
  it("runs the job where it is asked, and reports a refusal as the worker's", async () => {
    const pool = createInlinePool();
    expect(content(await pool.run(exchangeJob()))).toEqual(content(runJob(exchangeJob())));
    await expect(pool.run({ kind: "exchange", items: [], fb: 1, commission: 5 })).rejects.toMatchObject({ code: "failed" });
    await pool.close();
  });
});
