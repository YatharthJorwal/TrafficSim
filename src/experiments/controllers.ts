import {
  AdaptiveController,
  DEFAULT_ADAPTIVE,
  DEFAULT_TIMING,
  FixedTimeController,
  TWO_PHASE_PLAN,
  planFromCycle,
  type AdaptiveConfig,
  type FixedTimePlan,
  type PhaseDef,
  type PhaseId,
  type SignalController,
  type SignalTiming,
} from '../control';
import { ControlConfigError } from '../control/types';
import { criticalFlowByPhase, type DemandProfile } from './profiles';

/**
 * Effective saturation flow of one approach under signal control, veh per hour of green, measured in this simulator
 * (heavy demand, default 60 s plan, 20 % left turns: `npm run experiment -- --calibrate`). It is an input to the Webster
 * baseline only. A test re-measures it and fails if the engine drifts away from it.
 */
export const SATURATION_FLOW = 640;

/** The default fixed plan every profile is compared against: a 60 s cycle split equally. */
export const DEFAULT_FIXED_CYCLE = 60;

/** Fixed plans get the same minimum green as the adaptive controller (12 s keeps the pedestrian crossing window intact, D36). */
export const MIN_GREEN = DEFAULT_ADAPTIVE.minGreen;

export interface WebsterOptions {
  minCycle?: number;
  maxCycle?: number;
  minGreen?: number;
}

export interface WebsterResult {
  plan: FixedTimePlan;
  /** Cycle length of the plan (s). */
  cycle: number;
  /** Sum of the critical flow ratios (Y). At 1 or more the junction is over capacity and the cycle is capped. */
  flowRatio: number;
  /** Webster's optimum cycle before it was clamped to [minCycle, maxCycle] (Infinity when Y >= 1). */
  uncappedCycle: number;
}

/**
 * Webster's method: optimum cycle C = (1.5 L + 5) / (1 - Y), greens in proportion to each phase's critical flow ratio
 * y = flow / saturationFlow. L is all yellow plus all-red time. The cycle is clamped to what the timing rules allow
 * (a plan green must stay within [minGreen, maxGreen]); when the longest green would exceed maxGreen, every green is
 * scaled down in proportion, so the cycle shortens rather than the busy phase being short-changed.
 */
export function websterPlan(
  phases: readonly PhaseDef[],
  timing: SignalTiming,
  criticalFlow: Record<PhaseId, number>,
  saturationFlow: number = SATURATION_FLOW,
  options: WebsterOptions = {},
): WebsterResult {
  const lo = options.minGreen ?? MIN_GREEN;
  const hi = timing.maxGreen;
  const n = phases.length;
  const lost = n * (timing.yellow + timing.allRed);
  const minCycle = Math.max(options.minCycle ?? 0, lost + n * lo);
  const maxCycle = Math.min(options.maxCycle ?? 120, lost + n * hi);
  const issues: string[] = [];
  if (!(saturationFlow > 0)) issues.push('saturationFlow must be positive');
  if (maxCycle < minCycle) issues.push('no cycle length satisfies the timing limits');
  if (issues.length) throw new ControlConfigError(issues);

  const y = phases.map((p) => Math.max(1e-6, (criticalFlow[p.id] ?? 0) / saturationFlow));
  const Y = y.reduce((a, b) => a + b, 0);
  const uncapped = Y < 1 ? (1.5 * lost + 5) / (1 - Y) : Infinity;
  const cycle = Math.min(maxCycle, Math.max(minCycle, uncapped));

  // Split the green time in proportion to y. If the longest green would exceed maxGreen, scale ALL greens down so it
  // fits (the cycle gets shorter and the split stays in proportion; handing the surplus to a light phase instead
  // starves the busy one). Greens below the minimum are then raised to it.
  let greens = y.map((v) => ((cycle - lost) * v) / Y);
  const peak = Math.max(...greens);
  if (peak > hi) greens = greens.map((g) => (g * hi) / peak);
  greens = greens.map((g) => Math.max(lo, g));

  const plan: FixedTimePlan = { greens: {}, order: phases.map((p) => p.id) };
  phases.forEach((p, i) => {
    plan.greens[p.id] = Math.round(greens[i] * 10) / 10;
  });
  const realCycle = phases.reduce((s, p) => s + plan.greens[p.id], 0) + lost;
  return { plan, cycle: realCycle, flowRatio: Y, uncappedCycle: uncapped };
}

export type ControllerKind = 'fixed-default' | 'fixed-tuned' | 'adaptive' | 'adaptive-variant';

export interface ControllerSpec {
  id: string;
  label: string;
  kind: ControllerKind;
  /** A fresh controller for one run. Fixed plans may depend on the profile's demand; adaptive ones never do. */
  make(profile: DemandProfile): SignalController;
}

export function defaultFixed(phases: readonly PhaseDef[] = TWO_PHASE_PLAN, timing: SignalTiming = DEFAULT_TIMING): ControllerSpec {
  return {
    id: 'fixed-60',
    label: `Fixed ${DEFAULT_FIXED_CYCLE} s, equal split`,
    kind: 'fixed-default',
    make: () => new FixedTimeController(phases, timing, planFromCycle(phases, timing, DEFAULT_FIXED_CYCLE)),
  };
}

/** A fixed plan tuned (Webster) to the profile's time-averaged demand. A fixed plan cannot follow demand that changes in time. */
export function tunedFixed(
  phases: readonly PhaseDef[] = TWO_PHASE_PLAN,
  timing: SignalTiming = DEFAULT_TIMING,
  saturationFlow: number = SATURATION_FLOW,
): ControllerSpec {
  return {
    id: 'fixed-webster',
    label: 'Fixed, Webster-tuned to mean demand',
    kind: 'fixed-tuned',
    make: (profile) => new FixedTimeController(phases, timing, websterPlan(phases, timing, criticalFlowByPhase(profile, phases), saturationFlow).plan),
  };
}

export function adaptive(
  overrides: Partial<AdaptiveConfig> = {},
  id = 'adaptive',
  label = 'Adaptive (rule-based)',
  phases: readonly PhaseDef[] = TWO_PHASE_PLAN,
  timing: SignalTiming = DEFAULT_TIMING,
): ControllerSpec {
  return {
    id,
    label,
    kind: Object.keys(overrides).length === 0 ? 'adaptive' : 'adaptive-variant',
    make: () => new AdaptiveController(phases, timing, overrides),
  };
}

/** A fixed-time controller for an explicit plan. */
export function fixedFromPlan(plan: FixedTimePlan, id: string, label: string, kind: ControllerKind = 'fixed-tuned', phases: readonly PhaseDef[] = TWO_PHASE_PLAN, timing: SignalTiming = DEFAULT_TIMING): ControllerSpec {
  return { id, label, kind, make: () => new FixedTimeController(phases, timing, plan) };
}

/**
 * One-at-a-time sensitivity of the adaptive controller around its defaults. The defaults were chosen before M5 and are
 * not tuned against these results; the sweep shows how much the outcome depends on them.
 */
export function sensitivityVariants(): ControllerSpec[] {
  const out: ControllerSpec[] = [];
  const sweep = (key: keyof AdaptiveConfig, values: number[]) => {
    for (const v of values) out.push(adaptive({ [key]: v }, `adaptive:${key}=${v}`, `Adaptive, ${key} = ${v}`));
  };
  sweep('minGreen', [16, 20]);
  sweep('maxGreen', [35, 60]);
  sweep('maxWait', [45, 120]);
  sweep('switchRatio', [1.2, 2.0]);
  return out;
}
