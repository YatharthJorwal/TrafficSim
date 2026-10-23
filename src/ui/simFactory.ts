import { DEFAULT_TIMING, FixedTimeController, TWO_PHASE_PLAN, cycleLengthOf, planFromCycle } from '../control';
import { createConfig, uniformDemand } from '../sim/config';
import { ALL_GREEN, ALL_RED } from '../sim/debugSignals';
import { FixedStepLoop, SimulationRunner } from '../runtime';

export type SignalMode = 'controller' | 'green' | 'red';

export interface SimSettings {
  seed: number;
  /** Vehicles per hour on each approach (same for all four in this view). */
  rate: number;
  /** Fixed-time cycle length (s). */
  cycle: number;
}

export function makeLoop(s: SimSettings): FixedStepLoop {
  const config = createConfig({ seed: s.seed, duration: 3600 });
  config.demand = uniformDemand(s.rate);
  const plan = planFromCycle(TWO_PHASE_PLAN, DEFAULT_TIMING, s.cycle);
  const runner = new SimulationRunner(config, new FixedTimeController(TWO_PHASE_PLAN, DEFAULT_TIMING, plan), { diagnostics: true });
  return new FixedStepLoop(runner);
}

export function applySignalMode(loop: FixedStepLoop, mode: SignalMode): void {
  loop.runner.setDebugOverride(mode === 'green' ? ALL_GREEN : mode === 'red' ? ALL_RED : null);
}

export function describePlan(cycle: number): string {
  const plan = planFromCycle(TWO_PHASE_PLAN, DEFAULT_TIMING, cycle);
  return `green ${plan.greens.NS}s / ${plan.greens.EW}s, yellow ${DEFAULT_TIMING.yellow}s, all-red ${DEFAULT_TIMING.allRed}s, cycle ${cycleLengthOf(plan, DEFAULT_TIMING).toFixed(0)}s`;
}
