import type { SignalStates } from '../sim/types';
import { conflictingGreens, validatePhases, validateTiming } from './phases';
import {
  ControlConfigError,
  SafetyViolation,
  type PhaseDef,
  type PhaseId,
  type SignalEvent,
  type SignalStage,
  type SignalStatus,
  type SignalTiming,
} from './types';

const EPS = 1e-9;

export interface MachineStats {
  acceptedRequests: number;
  rejectedRequests: number;
  /** Times the max-green watchdog ended a green without a controller request. */
  watchdogSwitches: number;
}

/**
 * The only owner of real signal state. Cycle is always green -> yellow -> all-red -> green(next).
 * Controllers submit requests; the machine enforces minimum green, yellow, all-red, the max-green
 * watchdog and the no-conflicting-greens invariant. It has no dependency on the traffic engine.
 */
export class SignalStateMachine {
  readonly phases: readonly PhaseDef[];
  readonly timing: SignalTiming;
  readonly log: SignalEvent[] = [];
  readonly stats: MachineStats = { acceptedRequests: 0, rejectedRequests: 0, watchdogSwitches: 0 };

  private readonly initialPhase: PhaseId;
  private time = 0;
  private stage: SignalStage = 'green';
  private stageElapsed = 0;
  private current: PhaseId;
  private target: PhaseId | null = null;
  private pending: PhaseId | null = null;

  constructor(phases: readonly PhaseDef[], timing: SignalTiming, initialPhase?: PhaseId) {
    const issues = [...validatePhases(phases), ...validateTiming(timing)];
    if (initialPhase !== undefined && !phases.some((p) => p.id === initialPhase))
      issues.push(`initial phase "${initialPhase}" does not exist`);
    if (issues.length) throw new ControlConfigError(issues);
    this.phases = phases;
    this.timing = { ...timing };
    this.initialPhase = initialPhase ?? phases[0].id;
    this.current = this.initialPhase;
    this.reset();
  }

  reset(): void {
    this.time = 0;
    this.stage = 'green';
    this.stageElapsed = 0;
    this.current = this.initialPhase;
    this.target = null;
    this.pending = null;
    this.log.length = 0;
    this.stats.acceptedRequests = 0;
    this.stats.rejectedRequests = 0;
    this.stats.watchdogSwitches = 0;
    this.log.push({ time: 0, type: 'green', phase: this.current });
  }

  get colors(): SignalStates {
    const c: SignalStates = { N: 'red', E: 'red', S: 'red', W: 'red' };
    if (this.stage === 'allRed') return c;
    const color = this.stage === 'green' ? 'green' : 'yellow';
    const def = this.phases.find((p) => p.id === this.current)!;
    for (const a of def.greens) c[a] = color;
    return c;
  }

  get status(): SignalStatus {
    return {
      phase: this.current,
      nextPhase: this.stage === 'green' ? null : this.target,
      stage: this.stage,
      elapsed: this.stageElapsed,
      stageDuration:
        this.stage === 'yellow' ? this.timing.yellow : this.stage === 'allRed' ? this.timing.allRed : null,
      colors: this.colors,
    };
  }

  /**
   * Ask for a phase. Unknown phases are rejected. Asking for the current phase withdraws any pending
   * request. The request is honoured only when the machine's own rules allow it.
   */
  request(phase: PhaseId): boolean {
    if (!this.phases.some((p) => p.id === phase)) {
      this.stats.rejectedRequests++;
      return false;
    }
    this.stats.acceptedRequests++;
    this.pending = phase === this.current && this.stage === 'green' ? null : phase;
    return true;
  }

  /** Advance by dt seconds. Colours after this call apply to the next interval. */
  step(dt: number): void {
    this.time += dt;
    this.stageElapsed += dt;

    if (this.stage === 'green') {
      const watchdog = this.stageElapsed >= this.timing.maxGreen - EPS;
      const wantsChange = this.pending !== null && this.pending !== this.current;
      if (watchdog || (wantsChange && this.stageElapsed >= this.timing.minGreen - EPS)) {
        let next = wantsChange ? this.pending! : this.nextInOrder(this.current);
        if (next === this.current) next = this.nextInOrder(this.current);
        if (!wantsChange) this.stats.watchdogSwitches++;
        this.beginYellow(next);
      }
    } else if (this.stage === 'yellow') {
      if (this.stageElapsed >= this.timing.yellow - EPS) this.beginAllRed();
    } else if (this.stageElapsed >= this.timing.allRed - EPS) {
      this.beginGreen();
    }

    this.assertSafe();
  }

  private nextInOrder(id: PhaseId): PhaseId {
    const i = this.phases.findIndex((p) => p.id === id);
    return this.phases[(i + 1) % this.phases.length].id;
  }

  private beginYellow(next: PhaseId): void {
    this.stage = 'yellow';
    this.stageElapsed = 0;
    this.target = next;
    this.pending = null;
    this.log.push({ time: this.time, type: 'yellow', phase: this.current, next });
  }

  private beginAllRed(): void {
    this.stage = 'allRed';
    this.stageElapsed = 0;
    this.log.push({ time: this.time, type: 'allRed', phase: this.current, next: this.target! });
  }

  private beginGreen(): void {
    this.current = this.target!;
    this.target = null;
    this.stage = 'green';
    this.stageElapsed = 0;
    if (this.pending === this.current) this.pending = null;
    this.log.push({ time: this.time, type: 'green', phase: this.current });
  }

  private assertSafe(): void {
    const bad = conflictingGreens(this.colors);
    if (bad.length) throw new SafetyViolation(`conflicting signals ${bad.map(([a, b]) => `${a}/${b}`).join(', ')}`);
  }
}
