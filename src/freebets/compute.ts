import { convertAgainstExchange } from "./engine/exchange";
import { topPlans } from "./engine/funnel";
import { ComputeJob, ComputeResult } from "./jobs";

// Runs one job. Synchronous and pure: the worker thread calls it for each message
// (src/freebets/worker.ts), and a test, or a process with no worker, calls it
// directly (src/freebets/pool.ts, createInlinePool).
export function runJob(job: ComputeJob): ComputeResult {
  if (job.kind === "combos") {
    const { plans, stats } = topPlans(job.matches, job.fb, { size: job.size });
    return { kind: "combos", plans, stats };
  }
  return { kind: "exchange", result: convertAgainstExchange(job.items, job.fb, { commission: job.commission, minLaySize: 0 }) };
}
