import {
  ControlConfigError,
  type ControllerInput,
  type Measurements,
  type PhaseDef,
  type PhaseId,
  type PhaseRequest,
  type SignalController,
  type SignalTiming,
} from './types';

export interface AdaptiveConfig {
  /** Shortest green this controller gives (s). 12 s also lets a pedestrian finish crossing (see docs). */
  minGreen: number;
  /** Longest green while another phase is waiting (s). */
  maxGreen: number;
  /** A phase whose longest-waiting vehicle has waited this long is served next, whatever the pressures (s). */
  maxWait: number;
  /** Switch when the best other phase has at least this many times the current phase's pressure. */
  switchRatio: number;
  /** Switch when the current phase has no queue and at most this many vehicles approaching. */
  gapApproaching: number;
  /** A phase with less pressure than this has no demand. */
  demandFloor: number;
  /** Pressure of a phase that must be at least this to justify a switch on the ratio rule. */
  minSwitchPressure: number;
  /** Weight of vehicles still approaching (moving) relative to vehicles already queued. */
  approachWeight: number;
  /** Pressure added per second of average waiting time in the detector zone. */
  waitWeight: number;
}

export const DEFAULT_ADAPTIVE: AdaptiveConfig = {
  minGreen: 12,
  maxGreen: 50,
  maxWait: 75,
  switchRatio: 1.5,
  gapApproaching: 1,
  demandFloor: 0.5,
  minSwitchPressure: 2,
  approachWeight: 0.4,
  waitWeight: 0.12,
};

export function validateAdaptiveConfig(c: AdaptiveConfig, timing: SignalTiming): string[] {
  const e: string[] = [];
  const num = (n: number) => Number.isFinite(n);
  for (const [k, v] of Object.entries(c)) if (!num(v) || v < 0) e.push(`${k} must be a non-negative number`);
  if (c.minGreen < timing.minGreen) e.push(`minGreen (${c.minGreen}s) must be at least the safety minimum (${timing.minGreen}s)`);
  if (c.maxGreen < c.minGreen) e.push('maxGreen must be >= minGreen');
  if (c.maxGreen > timing.maxGreen) e.push(`maxGreen (${c.maxGreen}s) must not exceed the safety watchdog (${timing.maxGreen}s)`);
  if (c.maxWait < c.minGreen + timing.yellow + timing.allRed) e.push('maxWait is too short to ever be honoured');
  if (c.switchRatio < 1) e.push('switchRatio must be >= 1');
  return e;
}

export interface AdaptiveDecision {
  time: number;
  from: PhaseId;
  to: PhaseId;
  reason: 'max wait' | 'max green' | 'gap-out' | 'higher demand';
  /** Pressure of every phase when the decision was taken. */
  pressures: Record<PhaseId, number>;
}

/**
 * Transparent, deterministic rule-based adaptive controller.
 *
 * Each tick, while a green is running and has lasted at least `minGreen`, it looks at the detector measurements
 * and either keeps the green or asks for another phase. It only ever *requests*; the signal state machine
 * enforces yellow, all-red, minimum and maximum green and the conflict rules, so no rule here can make the
 * junction unsafe. Rules, in priority order:
 *   1. max wait   - some other phase has a vehicle that has waited >= maxWait: serve that phase.
 *   2. no demand  - nobody is waiting for another phase: stay.
 *   3. max green  - the green has lasted maxGreen and someone is waiting: switch.
 *   4. gap-out    - the current phase has no queue and (almost) nothing approaching: switch.
 *   5. pressure   - another phase has >= switchRatio times the current phase's pressure: switch.
 * Pressure of a phase = per approach: queued vehicles + approachWeight * approaching + waitWeight * average wait.
 */
export class AdaptiveController implements SignalController {
  readonly name = 'adaptive';
  readonly config: AdaptiveConfig;
  /** Every switch request made since the last reset (bounded). */
  readonly decisions: AdaptiveDecision[] = [];

  private readonly phases: readonly PhaseDef[];
  private last: AdaptiveDecision | null = null;

  constructor(phases: readonly PhaseDef[], timing: SignalTiming, config: Partial<AdaptiveConfig> = {}) {
    this.phases = phases;
    this.config = { ...DEFAULT_ADAPTIVE, ...config };
    const issues = validateAdaptiveConfig(this.config, timing);
    if (phases.length < 2) issues.push('an adaptive plan needs at least two phases');
    if (issues.length) throw new ControlConfigError(issues);
  }

  reset(): void {
    this.decisions.length = 0;
    this.last = null;
  }

  describe(): string {
    return this.last ? `last switch ${this.last.from} -> ${this.last.to} (${this.last.reason}) at ${this.last.time.toFixed(0)}s` : 'no switch yet';
  }

  pressure(phase: PhaseDef, m: Measurements): number {
    const { approachWeight, waitWeight } = this.config;
    let p = 0;
    for (const a of phase.greens) {
      const o = m[a].observed;
      p += o.queueLength + approachWeight * o.approaching + waitWeight * o.avgWait;
    }
    return p;
  }

  decide(input: ControllerInput): PhaseRequest | null {
    const { signal, measurements: m } = input;
    if (signal.stage !== 'green' || !m) return null;
    if (signal.elapsed + input.dt < this.config.minGreen - 1e-9) return null;

    const cur = this.phases.find((p) => p.id === signal.phase);
    if (!cur) return null;
    const others = this.phases.filter((p) => p.id !== cur.id);

    const pressures: Record<PhaseId, number> = {};
    for (const p of this.phases) pressures[p.id] = this.pressure(p, m);
    const worstWait = (p: PhaseDef) => Math.max(...p.greens.map((a) => m[a].observed.maxWait));
    const busiest = others.reduce((best, p) => (pressures[p.id] > pressures[best.id] ? p : best), others[0]);

    const choose = (to: PhaseDef, reason: AdaptiveDecision['reason']): PhaseRequest => {
      const d: AdaptiveDecision = { time: input.time, from: cur.id, to: to.id, reason, pressures };
      this.last = d;
      if (this.decisions.length < 500) this.decisions.push(d);
      return { phase: to.id, reason };
    };

    const longestWaiting = others.reduce((best, p) => (worstWait(p) > worstWait(best) ? p : best), others[0]);
    if (worstWait(longestWaiting) >= this.config.maxWait) return choose(longestWaiting, 'max wait');

    if (pressures[busiest.id] < this.config.demandFloor) return null;
    if (signal.elapsed + input.dt >= this.config.maxGreen - 1e-9) return choose(busiest, 'max green');

    const curQueue = Math.max(...cur.greens.map((a) => m[a].observed.queueLength));
    const curApproaching = cur.greens.reduce((n, a) => n + m[a].observed.approaching, 0);
    if (curQueue === 0 && curApproaching <= this.config.gapApproaching) return choose(busiest, 'gap-out');

    const curP = pressures[cur.id];
    if (pressures[busiest.id] >= this.config.minSwitchPressure && pressures[busiest.id] >= this.config.switchRatio * Math.max(curP, 1)) {
      return choose(busiest, 'higher demand');
    }
    return null;
  }
}
