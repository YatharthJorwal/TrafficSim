/**
 * Web Worker shell around `runBrowserExperiment`, so a run never freezes the page. Cancelling is done by the page
 * terminating the worker. All the logic (and its tests) live in browserRun.ts.
 */
import { runBrowserExperiment, type BrowserRunOutput, type BrowserRunSettings } from './browserRun';

export type WorkerRequest = { type: 'run'; settings: BrowserRunSettings };
export type WorkerReply =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; output: BrowserRunOutput }
  | { type: 'error'; message: string };

const ctx = self as unknown as { postMessage(message: WorkerReply): void; onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null };

ctx.onmessage = (event) => {
  try {
    const output = runBrowserExperiment(event.data.settings, { onProgress: (done, total) => ctx.postMessage({ type: 'progress', done, total }) });
    if (output) ctx.postMessage({ type: 'done', output });
  } catch (err) {
    ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
