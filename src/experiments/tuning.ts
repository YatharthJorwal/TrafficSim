import { DEFAULT_ADAPTIVE, DEFAULT_TIMING, TWO_PHASE_PLAN, planFromCycle, type FixedTimePlan, type PhaseDef, type SignalTiming } from '../control';
import { DEFAULT_FIXED_CYCLE, adaptive, defaultFixed, fixedFromPlan, tunedFixed, websterPlan, type ControllerSpec } from './controllers';
import { runOne } from './experiment';
import { buildSchedule, criticalFlowByPhase, type DemandProfile } from './profiles';

/**
 * The strongest fair fixed-time baseline. Candidates are a coarse grid of (cycle, green split), the Webster plan and
 * the default plan; the best one on the TUNING seeds is then refined locally. Choosing among them on seeds that no
 * evaluation run uses keeps this honest: it knows the demand in advance (unlike adaptive) but is never tuned against
 * the adaptive controller or against the evaluation results. A fixed plan cannot follow demand that changes in time,
 * so for the shifting profile it is the best single plan for the whole run.
 */

/** Tuning seeds live far above the evaluation seeds (1..n) so the two sets never overlap. */
export const TUNING_SEEDS: readonly number[] = [9001, 9002];
export const TUNING_CYCLES: readonly number[] = [40, 60, 90];
/** Share of the green time given to the first phase (North-South). */
export const TUNING_SHARES: readonly number[] = [0.3, 0.4, 0.5, 0.6, 0.7];
/** Local refinement moves the cycle by this many seconds and the split by this share. */
const REFINE_CYCLE_STEP = 10;
const REFINE_SHARE_STEP = 0.05;

export interface TuneCandidate {
  cycle: number;
  /** Share of the green time given to the first phase. */
  share: number;
  plan: FixedTimePlan;
  /** Mean over tuning seeds of the mean wait of all generated vehicles (s). Lower is better. */
  meanWait: number;
}

export interface TuneOptions {
  duration: number;
  seeds?: readonly number[];
  cycles?: readonly number[];
  shares?: readonly number[];
  phases?: readonly PhaseDef[];
  timing?: SignalTiming;
  /** Smallest green a candidate may have (s). Defaults to the adaptive controller's, so both get the same limit. */
  minGreen?: number;
  /** Extra plans to put into the candidate pool next to the grid (for example the default and Webster plans). */
  extraPlans?: readonly FixedTimePlan[];
  /** Rounds of local refinement around the best candidate (default 2; stops early when nothing improves). */
  refine?: number;
}

type Shape = { cycle: number; share: number; plan: FixedTimePlan };

const planKey = (p: FixedTimePlan) => p.order.map((id) => `${id}:${p.greens[id]}`).join('/');

/** Candidate two-phase plans for a grid. Combinations whose greens break the minimum or maximum green are skipped. */
export function candidatePlans(options: Pick<TuneOptions, 'cycles' | 'shares' | 'phases' | 'timing' | 'minGreen'> = {}): Shape[] {
  const phases = options.phases ?? TWO_PHASE_PLAN;
  const timing = options.timing ?? DEFAULT_TIMING;
  const lo = options.minGreen ?? DEFAULT_ADAPTIVE.minGreen;
  if (phases.length !== 2) throw new Error('the green-share grid is defined for two-phase plans');
  const lost = 2 * (timing.yellow + timing.allRed);
  const out: Shape[] = [];
  for (const cycle of options.cycles ?? TUNING_CYCLES) {
    for (const share of options.shares ?? TUNING_SHARES) {
      const g1 = Math.round((cycle - lost) * share * 10) / 10;
      const g2 = Math.round((cycle - lost - g1) * 10) / 10;
      if (g1 < lo - 1e-9 || g2 < lo - 1e-9 || g1 > timing.maxGreen + 1e-9 || g2 > timing.maxGreen + 1e-9) continue;
      out.push({ cycle, share, plan: { greens: { [phases[0].id]: g1, [phases[1].id]: g2 }, order: phases.map((p) => p.id) } });
    }
  }
  return out;
}

function describePlan(plan: FixedTimePlan, timing: SignalTiming): { cycle: number; share: number } {
  const [a, b] = plan.order.map((id) => plan.greens[id]);
  return { cycle: a + b + plan.order.length * (timing.yellow + timing.allRed), share: a / (a + b) };
}

export function tuneFixedPlan(profile: DemandProfile, options: TuneOptions): { best: TuneCandidate; candidates: TuneCandidate[] } {
  const seeds = options.seeds ?? TUNING_SEEDS;
  const timing = options.timing ?? DEFAULT_TIMING;
  const schedules = seeds.map((seed) => buildSchedule(profile, seed, options.duration));
  const candidates: TuneCandidate[] = [];
  const seen = new Set<string>();

  const evaluate = (shapes: Shape[]) => {
    for (const s of shapes) {
      const key = planKey(s.plan);
      if (seen.has(key)) continue;
      seen.add(key);
      const spec = fixedFromPlan(s.plan, `tune-${key}`, 'candidate');
      const waits = seeds.map((seed, i) => runOne({ profile, controller: spec, seed, duration: options.duration, schedule: schedules[i] }).vehicles.meanWait);
      candidates.push({ ...s, meanWait: waits.reduce((a, b) => a + b, 0) / waits.length });
    }
  };
  // strict "<" keeps the first of equal candidates, so the result is deterministic
  const bestOf = () => candidates.reduce((b, c) => (c.meanWait < b.meanWait ? c : b));

  const grid = candidatePlans(options);
  const extra = (options.extraPlans ?? []).map((plan) => ({ plan, ...describePlan(plan, timing) }));
  if (grid.length + extra.length === 0) throw new Error('the tuning grid has no valid plan');
  evaluate([...grid, ...extra]);

  for (let round = 0; round < (options.refine ?? 2); round++) {
    const before = bestOf();
    const round2 = (x: number) => Math.round(x * 100) / 100;
    evaluate(
      candidatePlans({
        ...options,
        cycles: [before.cycle - REFINE_CYCLE_STEP, before.cycle, before.cycle + REFINE_CYCLE_STEP],
        shares: [round2(before.share - REFINE_SHARE_STEP), round2(before.share), round2(before.share + REFINE_SHARE_STEP)],
      }),
    );
    if (bestOf() === before) break;
  }
  return { best: bestOf(), candidates };
}

/** The tuned plan is searched once per profile (it depends on the profile only) and then reused for every seed. */
export function searchedFixed(options: TuneOptions): ControllerSpec {
  const cache = new Map<string, FixedTimePlan>();
  const phases = options.phases ?? TWO_PHASE_PLAN;
  const timing = options.timing ?? DEFAULT_TIMING;
  return {
    id: 'fixed-searched',
    label: 'Fixed, best plan searched on separate seeds',
    kind: 'fixed-tuned',
    make: (profile) => {
      let plan = cache.get(profile.id);
      if (!plan) {
        const extraPlans = [
          planFromCycle(phases, timing, DEFAULT_FIXED_CYCLE),
          websterPlan(phases, timing, criticalFlowByPhase(profile, phases)).plan,
          ...(options.extraPlans ?? []),
        ];
        plan = tuneFixedPlan(profile, { ...options, extraPlans }).best.plan;
        cache.set(profile.id, plan);
      }
      return fixedFromPlan(plan, 'fixed-searched', 'searched').make(profile);
    },
  };
}

/**
 * The controllers every experiment compares: the default fixed plan, a Webster-tuned fixed plan, the best searched
 * fixed plan, and adaptive. `duration` is the experiment horizon (the search is run on the same horizon).
 */
export function standardControllers(duration: number): ControllerSpec[] {
  return [defaultFixed(), tunedFixed(), searchedFixed({ duration }), adaptive()];
}
