import { Worker } from "node:worker_threads";

export type HighsResult = {
  Status: string;
  ObjectiveValue: number;
  Columns: Record<string, { Primal: number; Name: string }>;
};

export type HighsModule = {
  solve: (lp: string) => HighsResult;
};

// HiGHS WASM retains solver state across calls in ways Node's GC can't clean
// up — even loading a fresh module via require-cache eviction leaks linear
// memory, and calling .solve() multiple times on one instance corrupts its
// function table. The only reliable isolation is terminating the whole process
// that ran the solve. We spawn a short-lived worker_thread per solve: HiGHS
// instantiates once inside it, returns the result, and the worker exits.
// Terminating the worker releases all WASM pages back to the OS.
//
// Workers are spawned with an inline eval script so we don't need a separate
// source file that Next.js would have to resolve at runtime. The script does
// exactly one thing: require("highs"), solve the LP, post the result back.
const workerSource = `
const { parentPort } = require("worker_threads");
parentPort.once("message", async (lp) => {
  try {
    const loader = require("highs");
    const highs = await loader();
    const result = highs.solve(lp);
    parentPort.postMessage({ ok: true, result });
  } catch (err) {
    parentPort.postMessage({
      ok: false,
      message: err && err.message ? err.message : String(err),
    });
  }
});
`;

export async function solveInWorker(lp: string): Promise<HighsResult> {
  return new Promise<HighsResult>((resolve, reject) => {
    const worker = new Worker(workerSource, { eval: true });
    let settled = false;
    worker.once("message", (msg: { ok: boolean; result?: HighsResult; message?: string }) => {
      settled = true;
      worker.terminate().catch(() => {});
      if (msg.ok && msg.result) {
        resolve(msg.result);
      } else {
        reject(new Error(msg.message || "HiGHS worker returned no result"));
      }
    });
    worker.once("error", (err) => {
      if (settled) return;
      settled = true;
      worker.terminate().catch(() => {});
      reject(err);
    });
    worker.once("exit", (code) => {
      if (settled) return;
      settled = true;
      reject(new Error(`HiGHS worker exited with code ${code} before returning`));
    });
    worker.postMessage(lp);
  });
}
