import { AdaptiveController, DEFAULT_ADAPTIVE, DEFAULT_TIMING, FixedTimeController, TWO_PHASE_PLAN, cycleLengthOf, planFromCycle, type SignalController } from '../control';
import { createConfig, uniformDemand } from '../sim/config';
import type { TrafficMode } from '../sim/types';
import { ALL_GREEN, ALL_RED } from '../sim/debugSignals';
import { FixedStepLoop, SimulationRunner } from '../runtime';

export type SignalMode = 'controller' | 'green' | 'red';
export type ControllerKind = 'fixed' | 'adaptive';

export interface SimSettings {
  seed: number;
  /** Which signal controller drives the junction. */
  controller: ControllerKind;
  /** 'circulating': a fixed fleet loops forever. 'arrivals': open boundary with Poisson arrivals (experiments). */
  mode: TrafficMode;
  /** Fleet size in circulating mode. */
  fleet: number;
  /** Vehicles per hour on each approach in arrivals mode (same for all four in this view). */
  rate: number;
  /** Fixed-time cycle length (s). */
  cycle: number;
}

export function makeLoop(s: SimSettings): FixedStepLoop {
  const config = createConfig({ seed: s.seed, duration: 3600, mode: s.mode, fleet: s.fleet });
  if (s.mode === 'arrivals') config.demand = uniformDemand(s.rate);
  const controller: SignalController =
    s.controller === 'adaptive'
      ? new AdaptiveController(TWO_PHASE_PLAN, DEFAULT_TIMING)
      : new FixedTimeController(TWO_PHASE_PLAN, DEFAULT_TIMING, planFromCycle(TWO_PHASE_PLAN, DEFAULT_TIMING, s.cycle));
  const runner = new SimulationRunner(config, controller, { diagnostics: true });
  return new FixedStepLoop(runner);
}

export function applySignalMode(loop: FixedStepLoop, mode: SignalMode): void {
  loop.runner.setDebugOverride(mode === 'green' ? ALL_GREEN : mode === 'red' ? ALL_RED : null);
}

export function describePlan(cycle: number, controller: ControllerKind = 'fixed'): string {
  if (controller === 'adaptive') {
    const c = DEFAULT_ADAPTIVE;
    return `green ${c.minGreen}-${c.maxGreen}s by demand, yellow ${DEFAULT_TIMING.yellow}s, all-red ${DEFAULT_TIMING.allRed}s, max wait ${c.maxWait}s`;
  }
  const plan = planFromCycle(TWO_PHASE_PLAN, DEFAULT_TIMING, cycle);
  return `green ${plan.greens.NS}s / ${plan.greens.EW}s, yellow ${DEFAULT_TIMING.yellow}s, all-red ${DEFAULT_TIMING.allRed}s, cycle ${cycleLengthOf(plan, DEFAULT_TIMING).toFixed(0)}s`;
}
