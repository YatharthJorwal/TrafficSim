import type { VehicleObservation } from '../sim/types';
import type { SimulationRunner } from './runner';

const MAX_FRAME_SECONDS = 0.1;
const MAX_STEPS_PER_ADVANCE = 400;

/**
 * Turns variable real frame times into whole fixed simulation steps (accumulator pattern), and keeps the
 * last two vehicle states so the renderer can interpolate. The number of steps taken depends only on elapsed
 * time and speed, never on frame rate, and rendering never triggers extra engine work.
 */
export class FixedStepLoop {
  readonly runner: SimulationRunner;
  speed = 1;
  running = true;

  private acc = 0;
  private _prev: readonly VehicleObservation[];
  private _curr: readonly VehicleObservation[];
  private stepListeners = new Set<(runner: SimulationRunner) => void>();
  private resetListeners = new Set<() => void>();

  constructor(runner: SimulationRunner) {
    this.runner = runner;
    this._curr = runner.lastObservations;
    this._prev = this._curr;
  }

  /** Called after every simulation step (for cosmetic layers such as pedestrians). Returns an unsubscribe function. */
  onStep(fn: (runner: SimulationRunner) => void): () => void {
    this.stepListeners.add(fn);
    return () => this.stepListeners.delete(fn);
  }
  onReset(fn: () => void): () => void {
    this.resetListeners.add(fn);
    return () => this.resetListeners.delete(fn);
  }

  get prev(): readonly VehicleObservation[] {
    return this._prev;
  }
  get curr(): readonly VehicleObservation[] {
    return this._curr;
  }
  /** Fraction of the next step already elapsed, in [0, 1). */
  get alpha(): number {
    return Math.min(1, Math.max(0, this.acc / this.runner.engine.config.dt));
  }

  /** Feed real elapsed seconds since the last frame. Returns the number of simulation steps executed. */
  advance(realSeconds: number): number {
    if (!this.running) return 0;
    const dt = this.runner.engine.config.dt;
    this.acc += Math.min(Math.max(realSeconds, 0), MAX_FRAME_SECONDS) * this.speed;
    let steps = Math.floor(this.acc / dt + 1e-9);
    if (steps > MAX_STEPS_PER_ADVANCE) {
      steps = MAX_STEPS_PER_ADVANCE;
      this.acc = 0;
    } else {
      this.acc = Math.max(0, this.acc - steps * dt);
    }
    for (let i = 0; i < steps; i++) {
      if (i === steps - 1) this._prev = this.runner.lastObservations;
      this.runner.tick();
      for (const fn of this.stepListeners) fn(this.runner);
    }
    if (steps > 0) this._curr = this.runner.lastObservations;
    return steps;
  }

  /** Advance the simulation by `seconds` of simulated time immediately and refresh the render buffers. */
  fastForward(seconds: number): void {
    const dt = this.runner.engine.config.dt;
    const steps = Math.max(0, Math.round(seconds / dt));
    for (let i = 0; i < steps; i++) {
      if (i === steps - 1) this._prev = this.runner.lastObservations;
      this.runner.tick();
      for (const fn of this.stepListeners) fn(this.runner);
    }
    if (steps > 0) this._curr = this.runner.lastObservations;
    this.acc = 0;
  }

  reset(): void {
    this.runner.reset();
    this.acc = 0;
    this._curr = this.runner.lastObservations;
    this._prev = this._curr;
    for (const fn of this.resetListeners) fn();
  }
}
