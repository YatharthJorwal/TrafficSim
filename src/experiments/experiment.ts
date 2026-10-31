import { TWO_PHASE_PLAN } from '../control';
import { SimulationRunner } from '../runtime';
import { APPROACHES, type Approach, type Arrival } from '../sim/types';
import type { ControllerSpec } from './controllers';
import { RunRecorder, computeVehicleMetrics, type QueueMetrics, type VehicleMetrics } from './metrics';
import { buildSchedule, profileConfig, scheduleChecksum, type DemandProfile } from './profiles';
import { comparePaired, summarize, type PairedComparison, type Summary } from './stats';

export interface RunResult {
  profileId: string;
  controllerId: string;
  seed: number;
  duration: number;
  /** Fingerprint of the arrival schedule this run used. Identical for every controller on the same profile and seed. */
  scheduleChecksum: string;
  vehicles: VehicleMetrics;
  queues: QueueMetrics;
  safety: { redLightEntries: number; safetyClamps: number; overlapPairSteps: number; watchdogSwitches: number };
  /** Accepted phase-change requests (how often the signals switched). */
  signalSwitches: number;
}

export interface RunInput {
  profile: DemandProfile;
  controller: ControllerSpec;
  seed: number;
  duration: number;
  /** Pass a pre-built schedule to share it between controllers; built from (profile, seed, duration) when omitted. */
  schedule?: readonly Arrival[];
  /** Per-step body-overlap checks. Slower; on for safety tests. */
  diagnostics?: boolean;
}

/** One run: one profile, one controller, one seed, arrivals mode, the whole horizon [0, duration]. */
export function runOne(input: RunInput): RunResult {
  const { profile, controller, seed, duration } = input;
  const schedule = input.schedule ?? buildSchedule(profile, seed, duration);
  const config = profileConfig(profile, seed, duration);
  const runner = new SimulationRunner(config, controller.make(profile), { schedule, diagnostics: input.diagnostics });
  const recorder = new RunRecorder(TWO_PHASE_PLAN);

  const dt = config.dt;
  const target = Math.round(duration / dt);
  const entered: Record<Approach, number> = { N: 0, E: 0, S: 0, W: 0 };
  while (runner.engine.steps < target) {
    runner.tick();
    for (const a of APPROACHES) entered[a] = runner.engine.stats.perApproach[a].enteredIntersection;
    // engine.signals still holds the colours the engine used for the step that just ran
    recorder.sample(dt, runner.engine.signals, runner.detectors.measurements, entered);
  }

  const s = runner.engine.stats;
  return {
    profileId: profile.id,
    controllerId: controller.id,
    seed,
    duration,
    scheduleChecksum: scheduleChecksum(schedule),
    vehicles: computeVehicleMetrics(runner.engine.ledger(), duration),
    queues: recorder.result(),
    safety: {
      redLightEntries: s.redLightEntries,
      safetyClamps: s.safetyClamps,
      overlapPairSteps: s.overlapPairSteps,
      watchdogSwitches: runner.machine.stats.watchdogSwitches,
    },
    signalSwitches: runner.machine.stats.acceptedRequests,
  };
}

export interface ExperimentOptions {
  profiles: readonly DemandProfile[];
  controllers: readonly ControllerSpec[];
  seeds: readonly number[];
  duration: number;
  diagnostics?: boolean;
  onRun?: (done: number, total: number, result: RunResult) => void;
}

export interface ExperimentResults {
  duration: number;
  seeds: number[];
  profiles: string[];
  controllers: string[];
  runs: RunResult[];
}

/**
 * Paired experiment: for every (profile, seed) the arrival schedule is built once and every controller runs on that
 * very schedule. Rows come back in a fixed order (profile, seed, controller), so the output is reproducible.
 */
export function runExperiment(options: ExperimentOptions): ExperimentResults {
  const { profiles, controllers, seeds, duration } = options;
  if (profiles.length === 0 || controllers.length === 0 || seeds.length === 0) throw new Error('need at least one profile, controller and seed');
  if (new Set(controllers.map((c) => c.id)).size !== controllers.length) throw new Error('controller ids must be unique');
  const total = profiles.length * seeds.length * controllers.length;
  const runs: RunResult[] = [];
  for (const profile of profiles) {
    for (const seed of seeds) {
      const schedule = buildSchedule(profile, seed, duration);
      for (const controller of controllers) {
        const result = runOne({ profile, controller, seed, duration, schedule, diagnostics: options.diagnostics });
        runs.push(result);
        options.onRun?.(runs.length, total, result);
      }
    }
  }
  return { duration, seeds: [...seeds], profiles: profiles.map((p) => p.id), controllers: controllers.map((c) => c.id), runs };
}

// ------------------------------------------------------------------ aggregation

export interface MetricDef {
  key: string;
  label: string;
  unit: string;
  lowerIsBetter: boolean;
  /** Differences smaller than this count as a tie when comparing single seeds. */
  tieTolerance: number;
  get(r: RunResult): number;
}

export const METRICS: readonly MetricDef[] = [
  { key: 'clearedPerHour', label: 'Cleared per hour', unit: 'veh/h', lowerIsBetter: false, tieTolerance: 1, get: (r) => r.vehicles.clearedPerHour },
  { key: 'meanWait', label: 'Mean wait (all generated)', unit: 's', lowerIsBetter: true, tieTolerance: 0.1, get: (r) => r.vehicles.meanWait },
  { key: 'p95Wait', label: '95th percentile wait', unit: 's', lowerIsBetter: true, tieTolerance: 0.5, get: (r) => r.vehicles.p95Wait },
  { key: 'maxWait', label: 'Longest wait', unit: 's', lowerIsBetter: true, tieTolerance: 0.5, get: (r) => r.vehicles.maxWait },
  { key: 'maxQueue', label: 'Max queue (detector)', unit: 'veh', lowerIsBetter: true, tieTolerance: 0, get: (r) => r.queues.maxQueue },
  { key: 'avgQueue', label: 'Mean queue (detector)', unit: 'veh', lowerIsBetter: true, tieTolerance: 0.05, get: (r) => r.queues.avgQueue },
  { key: 'unserved', label: 'Unserved at end', unit: 'veh', lowerIsBetter: true, tieTolerance: 0, get: (r) => r.vehicles.generated - r.vehicles.exited },
  { key: 'meanTimeStopped', label: 'Mean time stopped', unit: 's', lowerIsBetter: true, tieTolerance: 0.1, get: (r) => r.vehicles.meanTimeStopped },
  { key: 'meanWaitExitedOnly', label: 'Mean wait, exited only (survivor-biased)', unit: 's', lowerIsBetter: true, tieTolerance: 0.1, get: (r) => r.vehicles.meanWaitExitedOnly },
  { key: 'signalSwitches', label: 'Signal switches', unit: '', lowerIsBetter: false, tieTolerance: 0, get: (r) => r.signalSwitches },
];

export const metricByKey = (key: string): MetricDef => {
  const m = METRICS.find((x) => x.key === key);
  if (!m) throw new Error(`unknown metric "${key}"`);
  return m;
};

export interface CellSummary {
  profileId: string;
  controllerId: string;
  n: number;
  metrics: Record<string, Summary>;
  /** Worst safety counters over the seeds (all expected to be 0). */
  safety: { redLightEntries: number; safetyClamps: number; overlapPairSteps: number; watchdogSwitches: number };
}

export function aggregate(results: ExperimentResults): CellSummary[] {
  const cells: CellSummary[] = [];
  for (const profileId of results.profiles) {
    for (const controllerId of results.controllers) {
      const rs = results.runs.filter((r) => r.profileId === profileId && r.controllerId === controllerId);
      const metrics: Record<string, Summary> = {};
      for (const m of METRICS) metrics[m.key] = summarize(rs.map(m.get));
      const worst = (f: (r: RunResult) => number) => Math.max(0, ...rs.map(f));
      cells.push({
        profileId,
        controllerId,
        n: rs.length,
        metrics,
        safety: {
          redLightEntries: worst((r) => r.safety.redLightEntries),
          safetyClamps: worst((r) => r.safety.safetyClamps),
          overlapPairSteps: worst((r) => r.safety.overlapPairSteps),
          watchdogSwitches: worst((r) => r.safety.watchdogSwitches),
        },
      });
    }
  }
  return cells;
}

/** Per-seed pairing of two controllers on one profile and metric (same seed = same arrival schedule). */
export function pairedComparison(results: ExperimentResults, profileId: string, referenceId: string, candidateId: string, metric: MetricDef): PairedComparison {
  const pick = (controllerId: string) =>
    results.seeds.map((seed) => {
      const r = results.runs.find((x) => x.profileId === profileId && x.controllerId === controllerId && x.seed === seed);
      if (!r) throw new Error(`missing run: ${profileId} / ${controllerId} / seed ${seed}`);
      return r;
    });
  const ref = pick(referenceId);
  const cand = pick(candidateId);
  ref.forEach((r, i) => {
    if (r.scheduleChecksum !== cand[i].scheduleChecksum) throw new Error(`${profileId} seed ${r.seed}: the two controllers did not see the same schedule`);
  });
  return comparePaired(ref.map(metric.get), cand.map(metric.get), metric.lowerIsBetter, metric.tieTolerance);
}

export type Verdict = 'better' | 'worse' | 'no clear difference';

/**
 * Mechanical verdict from the paired differences: "better" or "worse" only when the 95 % confidence interval of the
 * mean difference excludes zero; otherwise "no clear difference". With one seed there is no interval, so never a verdict.
 */
export function verdict(c: PairedComparison, lowerIsBetter: boolean): Verdict {
  const { mean, ci95 } = c.difference;
  if (ci95 === null || Math.abs(mean) <= ci95) return 'no clear difference';
  return (mean < 0) === lowerIsBetter ? 'better' : 'worse';
}
