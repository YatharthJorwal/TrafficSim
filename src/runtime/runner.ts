import { DEFAULT_TIMING, SignalStateMachine, TWO_PHASE_PLAN, type PhaseDef, type PhaseId, type SignalController, type SignalStatus, type SignalTiming } from '../control';
import { DetectorSystem, createDetectorConfig, type DetectorConfig } from '../detectors';
import { SimulationEngine } from '../sim/engine';
import type { Arrival, SignalStates, SimConfig, SimSnapshot } from '../sim/types';

export interface RunnerOptions {
  /** Share one pre-generated schedule between runners so every controller sees identical arrivals. */
  schedule?: readonly Arrival[];
  diagnostics?: boolean;
  phases?: readonly PhaseDef[];
  timing?: SignalTiming;
  initialPhase?: PhaseId;
  /** Detector zone settings (zone length, observation window, ...). */
  detectors?: Partial<DetectorConfig>;
}

export interface RunnerSnapshot extends SimSnapshot {
  signal: SignalStatus;
  controller: string;
  /** True while a debug override (not the controller) is driving the signals. */
  overridden: boolean;
}

/**
 * Wires engine, signal state machine and controller together in a fixed order each tick:
 *   1. controller decides from the current status and detector measurements, and submits a request
 *   2. the machine's colours for [t, t+dt) are applied to the engine
 *   3. the engine advances one step
 *   4. the detectors sample the new vehicle positions
 *   5. the machine advances one step (and may start a transition)
 * Nothing here depends on rendering, so results are identical at any frame rate.
 */
export class SimulationRunner {
  readonly engine: SimulationEngine;
  readonly machine: SignalStateMachine;
  readonly controller: SignalController;
  readonly detectors: DetectorSystem;

  private override: SignalStates | null = null;

  constructor(config: SimConfig, controller: SignalController, options: RunnerOptions = {}) {
    this.controller = controller;
    this.machine = new SignalStateMachine(
      options.phases ?? TWO_PHASE_PLAN,
      options.timing ?? DEFAULT_TIMING,
      options.initialPhase,
    );
    this.engine = new SimulationEngine(config, {
      schedule: options.schedule,
      diagnostics: options.diagnostics,
      signals: this.machine.colors,
    });
    this.detectors = new DetectorSystem(createDetectorConfig(options.detectors, config.vehicle.length));
    this.controller.reset();
  }

  get time(): number {
    return this.engine.time;
  }

  tick(): void {
    const dt = this.engine.config.dt;
    if (!this.override) {
      const request = this.controller.decide({
        time: this.engine.time,
        dt,
        signal: this.machine.status,
        measurements: this.detectors.measurements,
      });
      if (request) this.machine.request(request.phase);
    }
    this.engine.setSignals(this.override ?? this.machine.colors);
    this.engine.step();
    this.detectors.update(this.engine.time, dt, this.engine.observe());
    if (!this.override) this.machine.step(dt);
  }

  run(untilTime: number): void {
    const target = Math.round(untilTime / this.engine.config.dt);
    while (this.engine.steps < target) this.tick();
  }

  /** Restart from t = 0: engine, signal machine and controller. The schedule is kept. */
  reset(): void {
    this.override = null;
    this.engine.reset();
    this.machine.reset();
    this.detectors.reset();
    this.controller.reset();
    this.engine.setSignals(this.machine.colors);
  }

  /**
   * DEBUG ONLY. Forces fixed signal colours and bypasses the controller and safety layer so the engine
   * can be inspected in isolation. Experiments never use this. Pass null to hand control back.
   */
  setDebugOverride(states: SignalStates | null): void {
    this.override = states ? { ...states } : null;
  }

  snapshot(): RunnerSnapshot {
    const snap = this.engine.snapshot();
    return { ...snap, signal: this.machine.status, controller: this.controller.name, overridden: this.override !== null };
  }
}
