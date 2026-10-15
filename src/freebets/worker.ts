import { parentPort } from "node:worker_threads";
import { runJob } from "./compute";
import { ComputeJob } from "./jobs";

// The worker thread's side of src/freebets/pool.ts: one job at a time, each
// answered with the same id. It reads nothing from the databases and opens no
// file: the engine gets plain data and gives plain data.
const port = parentPort;
if (!port) throw new Error("src/freebets/worker.ts runs in a worker thread");

port.on("message", ({ id, job }: { id: number; job: ComputeJob }) => {
  try {
    port.postMessage({ id, ok: true, result: runJob(job) });
  } catch (err) {
    port.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
