import type { Measurements } from '../detectors/types';
import type { PhaseDef, PhaseId } from '../control/types';
import { APPROACHES, type Approach, type SignalStates, type VehicleLedgerEntry } from '../sim/types';
import { mean, percentile } from './stats';

/**
 * Metrics exactly as defined in docs/SPEC.md ("Metric definitions"). Window is [0, T], T = the run duration.
 * No drain period: vehicles that are still queued, on the road or in the entry backlog at T are reported, not hidden.
 */

export interface VehicleMetrics {
  /** Vehicles whose scheduled arrival time has passed. */
  generated: number;
  /** Placed on the road (generated minus the entry backlog). */
  inserted: number;
  exited: number;
  onRoad: number;
  /** Generated but still waiting for room to enter the road at T. */
  backlog: number;
  /** Exited / (T / 3600). */
  clearedPerHour: number;
  /** Mean over ALL generated vehicles of (queue wait upstream of the stop line + entry-backlog wait). Seconds. */
  meanWait: number;
  /** 95th percentile of the same per-vehicle wait. Seconds. */
  p95Wait: number;
  /** Longest wait of any generated vehicle. Seconds. */
  maxWait: number;
  /** Same wait averaged over exited vehicles only. Survivor-biased: kept to compare with the M4 preview, not a headline metric. */
  meanWaitExitedOnly: number;
  /** Mean seconds at speed < 0.1 m/s over vehicles that were placed on the road. Backlog time is not included. */
  meanTimeStopped: number;
}

export const vehicleWait = (e: VehicleLedgerEntry): number => e.queueWait + e.backlogWait;

export function computeVehicleMetrics(ledger: readonly VehicleLedgerEntry[], duration: number): VehicleMetrics {
  const waits = ledger.map(vehicleWait);
  const exited = ledger.filter((e) => e.status === 'exited');
  const placed = ledger.filter((e) => e.status !== 'backlog');
  return {
    generated: ledger.length,
    inserted: placed.length,
    exited: exited.length,
    onRoad: ledger.filter((e) => e.status === 'onRoad').length,
    backlog: ledger.filter((e) => e.status === 'backlog').length,
    clearedPerHour: exited.length / (duration / 3600),
    meanWait: mean(waits),
    p95Wait: percentile(waits, 0.95),
    maxWait: waits.length ? Math.max(...waits) : NaN,
    meanWaitExitedOnly: mean(exited.map(vehicleWait)),
    meanTimeStopped: mean(placed.map((e) => e.stoppedTime)),
  };
}

export interface PhaseUtilisation {
  /** Seconds in which every approach of the phase showed green. */
  greenSeconds: number;
  /** Stop-line crossings by the phase's approaches while their own signal was green. */
  entriesOnGreen: number;
  /** entriesOnGreen / greenSeconds (vehicles per green second, all approaches of the phase together). 0 if never green. */
  utilisation: number;
}

export interface QueueMetrics {
  /** Largest detector queue count (vehicles) on any approach at any time. Limited by the detector zone length. */
  maxQueue: number;
  /** Largest detector queue length (m) on any approach at any time. */
  maxQueueLengthM: number;
  /** Time-average of the detector queue count, averaged over the four approaches. */
  avgQueue: number;
  avgQueueByApproach: Record<Approach, number>;
  /** Share of the run (0..1) during which some approach's queue reached past the end of the detector zone. */
  zoneOverflowShare: number;
  phases: Record<PhaseId, PhaseUtilisation>;
}

/**
 * Accumulates queue and signal-utilisation metrics one tick at a time.
 * Feed it exactly what the runner used for the tick: the colours the engine ran with, the detector measurements
 * after the tick and the cumulative stop-line crossings per approach.
 */
export class RunRecorder {
  private readonly phases: readonly PhaseDef[];
  private time = 0;
  private maxQueue = 0;
  private maxQueueLengthM = 0;
  private queueSeconds: Record<Approach, number> = { N: 0, E: 0, S: 0, W: 0 };
  private overflowSeconds = 0;
  private lastEntered: Record<Approach, number> = { N: 0, E: 0, S: 0, W: 0 };
  private greenSeconds: Record<PhaseId, number> = {};
  private entriesOnGreen: Record<PhaseId, number> = {};

  constructor(phases: readonly PhaseDef[]) {
    this.phases = phases;
    for (const p of phases) {
      this.greenSeconds[p.id] = 0;
      this.entriesOnGreen[p.id] = 0;
    }
  }

  sample(dt: number, colors: SignalStates, measurements: Measurements, entered: Record<Approach, number>): void {
    this.time += dt;
    let overflow = false;
    for (const a of APPROACHES) {
      const o = measurements[a].observed;
      this.queueSeconds[a] += o.queueLength * dt;
      if (o.queueLength > this.maxQueue) this.maxQueue = o.queueLength;
      if (o.queueLengthM > this.maxQueueLengthM) this.maxQueueLengthM = o.queueLengthM;
      if (o.zoneOverflow) overflow = true;
    }
    if (overflow) this.overflowSeconds += dt;

    for (const p of this.phases) {
      if (p.greens.every((a) => colors[a] === 'green')) this.greenSeconds[p.id] += dt;
      for (const a of p.greens) {
        if (colors[a] === 'green') this.entriesOnGreen[p.id] += entered[a] - this.lastEntered[a];
      }
    }
    for (const a of APPROACHES) this.lastEntered[a] = entered[a];
  }

  result(): QueueMetrics {
    const t = this.time;
    const avg = (a: Approach) => (t > 0 ? this.queueSeconds[a] / t : 0);
    const avgQueueByApproach = { N: avg('N'), E: avg('E'), S: avg('S'), W: avg('W') };
    const phases: Record<PhaseId, PhaseUtilisation> = {};
    for (const p of this.phases) {
      const g = this.greenSeconds[p.id];
      const n = this.entriesOnGreen[p.id];
      phases[p.id] = { greenSeconds: g, entriesOnGreen: n, utilisation: g > 0 ? n / g : 0 };
    }
    return {
      maxQueue: this.maxQueue,
      maxQueueLengthM: this.maxQueueLengthM,
      avgQueue: mean(APPROACHES.map(avg)),
      avgQueueByApproach,
      zoneOverflowShare: t > 0 ? this.overflowSeconds / t : 0,
      phases,
    };
  }
}
