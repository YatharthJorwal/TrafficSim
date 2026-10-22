import { ControlConfigError, type ControllerInput, type PhaseDef, type PhaseId, type PhaseRequest, type SignalController, type SignalTiming } from './types';

const EPS = 1e-9;

export interface FixedTimePlan {
  /** Green duration per phase (s). */
  greens: Record<PhaseId, number>;
  /** Phase sequence; the first entry is the phase that starts green at t = 0. */
  order: PhaseId[];
}

export function cycleLengthOf(plan: FixedTimePlan, timing: SignalTiming): number {
  return plan.order.reduce((n, id) => n + plan.greens[id] + timing.yellow + timing.allRed, 0);
}

export function validateFixedTimePlan(phases: readonly PhaseDef[], timing: SignalTiming, plan: FixedTimePlan): string[] {
  const e: string[] = [];
  if (plan.order.length < 2) e.push('a fixed-time plan needs at least two phases in its order');
  for (const id of plan.order) {
    if (!phases.some((p) => p.id === id)) e.push(`plan references unknown phase "${id}"`);
    const g = plan.greens[id];
    if (typeof g !== 'number' || !Number.isFinite(g)) e.push(`green time for "${id}" is missing`);
    else if (g < timing.minGreen) e.push(`green for "${id}" (${g}s) is below minGreen (${timing.minGreen}s)`);
    else if (g > timing.maxGreen) e.push(`green for "${id}" (${g}s) is above maxGreen (${timing.maxGreen}s)`);
  }
  for (const p of phases) if (!plan.order.includes(p.id)) e.push(`phase "${p.id}" is not in the plan order`);
  return e;
}

/**
 * Build a plan for a target cycle length. Green time is what remains after yellow and all-red,
 * split in proportion to `split` (equal by default), rounded to 0.1 s.
 */
export function planFromCycle(
  phases: readonly PhaseDef[],
  timing: SignalTiming,
  cycleLength: number,
  split: Record<PhaseId, number> = {},
): FixedTimePlan {
  const lost = phases.length * (timing.yellow + timing.allRed);
  const effective = cycleLength - lost;
  const weights = phases.map((p) => split[p.id] ?? 1);
  const issues: string[] = [];
  if (!Number.isFinite(cycleLength)) issues.push('cycle length must be a finite number');
  if (weights.some((w) => !Number.isFinite(w) || w <= 0)) issues.push('split weights must be positive numbers');
  if (issues.length === 0 && effective < phases.length * timing.minGreen)
    issues.push(`cycle of ${cycleLength}s leaves ${effective.toFixed(1)}s of green; need at least ${phases.length * timing.minGreen}s`);
  if (issues.length) throw new ControlConfigError(issues);

  const total = weights.reduce((a, b) => a + b, 0);
  const greens: Record<PhaseId, number> = {};
  phases.forEach((p, i) => {
    greens[p.id] = Math.round(((effective * weights[i]) / total) * 10) / 10;
  });
  const plan: FixedTimePlan = { greens, order: phases.map((p) => p.id) };
  const problems = validateFixedTimePlan(phases, timing, plan);
  if (problems.length) throw new ControlConfigError(problems);
  return plan;
}

/** Predetermined green durations in a fixed sequence. Ignores all measurements. */
export class FixedTimeController implements SignalController {
  readonly name = 'fixed-time';
  readonly plan: FixedTimePlan;

  constructor(phases: readonly PhaseDef[], timing: SignalTiming, plan: FixedTimePlan) {
    const issues = validateFixedTimePlan(phases, timing, plan);
    if (issues.length) throw new ControlConfigError(issues);
    this.plan = { greens: { ...plan.greens }, order: [...plan.order] };
  }

  reset(): void {
    // stateless
  }

  decide(input: ControllerInput): PhaseRequest | null {
    const s = input.signal;
    if (s.stage !== 'green') return null;
    const i = this.plan.order.indexOf(s.phase);
    if (i < 0) return null;
    // The request lands in the same tick that the green reaches its planned length.
    if (s.elapsed + input.dt < this.plan.greens[s.phase] - EPS) return null;
    return { phase: this.plan.order[(i + 1) % this.plan.order.length], reason: 'fixed-time green expired' };
  }
}
