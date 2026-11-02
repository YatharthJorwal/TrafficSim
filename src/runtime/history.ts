import type { SignalStage } from '../control/types';
import { APPROACHES, type Approach } from '../sim/types';
import type { FixedStepLoop } from './loop';

/** One sample of what the detectors and the signal machine showed at a simulated time. Observed values only. */
export interface HistorySample {
  /** Simulated time (s). */
  t: number;
  /** Detector queue per approach (vehicles). */
  queue: Record<Approach, number>;
  /** Phase that is green, or that just ended while in yellow / all-red. */
  phase: string;
  stage: SignalStage;
}

export interface HistoryOptions {
  /** Simulated seconds between samples (default 1). */
  interval?: number;
  /** Most recent samples kept (default 300, i.e. 5 minutes at 1 s). */
  capacity?: number;
}

/**
 * Keeps a rolling window of detector queues and signal phase for the live charts. It only listens to the loop
 * (`onStep`, `onReset`) and reads detectors and the signal status, so it can never change the simulation.
 * Sampling follows simulated time, so pause and speed behave correctly and frame rate is irrelevant.
 */
export class HistoryRecorder {
  readonly interval: number;
  readonly capacity: number;
  private data: HistorySample[] = [];
  private nextAt: number;
  private readonly off: (() => void)[];

  constructor(private readonly loop: FixedStepLoop, options: HistoryOptions = {}) {
    this.interval = options.interval ?? 1;
    this.capacity = options.capacity ?? 300;
    if (!(this.interval > 0) || !(this.capacity >= 2)) throw new Error('history needs interval > 0 and capacity >= 2');
    this.nextAt = this.interval;
    this.off = [loop.onStep(() => this.step()), loop.onReset(() => this.clear())];
  }

  get samples(): readonly HistorySample[] {
    return this.data;
  }

  private step(): void {
    const r = this.loop.runner;
    const t = r.engine.time;
    if (t + 1e-9 < this.nextAt) return;
    // one sample per interval boundary, even if a step jumped past several
    this.nextAt = (Math.floor((t + 1e-9) / this.interval) + 1) * this.interval;
    const m = r.detectors.measurements;
    const status = r.machine.status;
    const queue = {} as Record<Approach, number>;
    for (const a of APPROACHES) queue[a] = m[a].observed.queueLength;
    this.data.push({ t, queue, phase: status.phase, stage: status.stage });
    if (this.data.length > this.capacity) this.data.splice(0, this.data.length - this.capacity);
  }

  clear(): void {
    this.data = [];
    this.nextAt = this.interval;
  }

  dispose(): void {
    for (const f of this.off) f();
  }
}
