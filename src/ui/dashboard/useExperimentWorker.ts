import { useCallback, useEffect, useRef, useState } from 'react';
import type { BrowserRunOutput, BrowserRunSettings } from '../../experiments/browserRun';
import type { WorkerReply, WorkerRequest } from '../../experiments/worker';

export interface WorkerState {
  status: 'idle' | 'running' | 'done' | 'error' | 'cancelled';
  done: number;
  total: number;
  output: BrowserRunOutput | null;
  error: string | null;
}

const IDLE: WorkerState = { status: 'idle', done: 0, total: 0, output: null, error: null };

/**
 * Runs an experiment in a Web Worker so the page stays responsive. Cancelling terminates the worker; the previous
 * result stays on screen until a new run finishes.
 */
export function useExperimentWorker() {
  const [state, setState] = useState<WorkerState>(IDLE);
  const worker = useRef<Worker | null>(null);

  const stop = useCallback(() => {
    worker.current?.terminate();
    worker.current = null;
  }, []);

  const run = useCallback(
    (settings: BrowserRunSettings) => {
      stop();
      if (typeof Worker === 'undefined') {
        setState((s) => ({ ...s, status: 'error', error: 'This browser cannot run background workers, so the experiment cannot run here.' }));
        return;
      }
      const w = new Worker(new URL('../../experiments/worker.ts', import.meta.url), { type: 'module' });
      worker.current = w;
      setState((s) => ({ ...s, status: 'running', done: 0, total: settings.seeds * settings.controllers.length, error: null }));
      w.onmessage = (e: MessageEvent<WorkerReply>) => {
        const m = e.data;
        if (m.type === 'progress') setState((s) => ({ ...s, done: m.done, total: m.total }));
        else if (m.type === 'done') {
          setState({ status: 'done', done: 1, total: 1, output: m.output, error: null });
          stop();
        } else {
          setState((s) => ({ ...s, status: 'error', error: m.message }));
          stop();
        }
      };
      w.onerror = (e) => {
        setState((s) => ({ ...s, status: 'error', error: e.message || 'The experiment worker stopped unexpectedly.' }));
        stop();
      };
      w.postMessage({ type: 'run', settings } satisfies WorkerRequest);
    },
    [stop],
  );

  const cancel = useCallback(() => {
    stop();
    setState((s) => ({ ...s, status: 'cancelled' }));
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { state, run, cancel };
}
