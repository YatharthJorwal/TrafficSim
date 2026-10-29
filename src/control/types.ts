import type { Approach, SignalStates } from '../sim/types';

/** Identifier of a signal phase (a set of approaches that may show green together). */
export type PhaseId = string;

export interface PhaseDef {
  id: PhaseId;
  label: string;
  /** Approaches that get green in this phase. Must be mutually compatible. */
  greens: readonly Approach[];
}

/** Safety timing owned by the signal state machine. Controllers cannot change or bypass it. */
export interface SignalTiming {
  /** Yellow duration after every green (s). */
  yellow: number;
  /** All-red clearance after every yellow (s). */
  allRed: number;
  /** A green cannot be ended by a request before this long (s). */
  minGreen: number;
  /** Watchdog: the machine itself ends a green after this long (s). */
  maxGreen: number;
}

export type SignalStage = 'green' | 'yellow' | 'allRed';

/** Read-only view of the signal state machine, given to controllers and the UI. */
export interface SignalStatus {
  /** Phase currently green, or the phase that just ended while in yellow / all-red. */
  phase: PhaseId;
  /** Phase that will turn green next while in yellow / all-red; null during green. */
  nextPhase: PhaseId | null;
  stage: SignalStage;
  /** Seconds spent in the current stage. */
  elapsed: number;
  /** Fixed length of the stage (yellow / all-red); null for green. */
  stageDuration: number | null;
  colors: SignalStates;
}

export interface SignalEvent {
  time: number;
  type: 'green' | 'yellow' | 'allRed';
  /** Phase that is green (for 'green') or that just ended (for 'yellow' and 'allRed'). */
  phase: PhaseId;
  /** Phase that will follow (for 'yellow' and 'allRed'). */
  next?: PhaseId;
}

export type { ApproachMeasurement, Measurements } from '../detectors/types';
import type { Measurements } from '../detectors/types';

export interface PhaseRequest {
  phase: PhaseId;
  reason?: string;
}

export interface ControllerInput {
  /** Simulation time at the start of this tick (s). */
  time: number;
  /** Fixed timestep (s). */
  dt: number;
  signal: SignalStatus;
  /** Undefined until the detector layer exists, and for controllers that do not need it. */
  measurements?: Measurements;
}

/**
 * A signal controller only *requests* a phase. The state machine decides whether and when the request
 * is honoured (min green, yellow, all-red, watchdog), so no controller can create unsafe signal states.
 */
export interface SignalController {
  readonly name: string;
  reset(): void;
  decide(input: ControllerInput): PhaseRequest | null;
  /** Optional one-line explanation of the latest decision, for the UI and logs. */
  describe?(): string;
}

export class ControlConfigError extends Error {
  readonly issues: readonly string[];
  constructor(issues: string[]) {
    super(`Invalid signal configuration:\n - ${issues.join('\n - ')}`);
    this.name = 'ControlConfigError';
    this.issues = issues;
  }
}

export class SafetyViolation extends Error {
  constructor(message: string) {
    super(`Signal safety violation: ${message}`);
    this.name = 'SafetyViolation';
  }
}
