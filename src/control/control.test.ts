import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../sim/rng';
import { APPROACHES, type SignalStates } from '../sim/types';
import {
  ControlConfigError,
  DEFAULT_TIMING,
  FixedTimeController,
  SafetyViolation,
  SignalStateMachine,
  TWO_PHASE_PLAN,
  approachesConflict,
  conflictingGreens,
  cycleLengthOf,
  planFromCycle,
  validatePhases,
  validateTiming,
  type PhaseDef,
  type SignalController,
} from './index';

const DT = 0.05;
const T = DEFAULT_TIMING;

/** Drive a machine + controller for `seconds`, as the runner does, recording colours per tick. */
function drive(machine: SignalStateMachine, controller: SignalController, seconds: number) {
  const ticks = Math.round(seconds / DT);
  const colors: SignalStates[] = [];
  for (let k = 0; k < ticks; k++) {
    const req = controller.decide({ time: k * DT, dt: DT, signal: machine.status });
    if (req) machine.request(req.phase);
    colors.push(machine.colors);
    machine.step(DT);
  }
  return colors;
}

function greenDurations(machine: SignalStateMachine, phase: string): number[] {
  const out: number[] = [];
  const log = machine.log;
  for (let i = 0; i < log.length - 1; i++) {
    if (log[i].type === 'green' && log[i].phase === phase) out.push(log[i + 1].time - log[i].time);
  }
  return out;
}

describe('phase and timing validation', () => {
  it('knows which approaches conflict', () => {
    expect(approachesConflict('N', 'S')).toBe(false);
    expect(approachesConflict('E', 'W')).toBe(false);
    expect(approachesConflict('N', 'E')).toBe(true);
    expect(approachesConflict('S', 'W')).toBe(true);
  });
  it('accepts the two-phase plan and default timing', () => {
    expect(validatePhases(TWO_PHASE_PLAN)).toEqual([]);
    expect(validateTiming(T)).toEqual([]);
  });
  it('rejects phases with conflicting greens, gaps and duplicates', () => {
    const bad: PhaseDef[] = [
      { id: 'A', label: 'a', greens: ['N', 'E'] },
      { id: 'A', label: 'dup', greens: ['S'] },
    ];
    const issues = validatePhases(bad).join('\n');
    expect(issues).toMatch(/conflicting approaches N and E/);
    expect(issues).toMatch(/duplicate phase id/);
    expect(issues).toMatch(/approach W is never served/);
    expect(() => new SignalStateMachine(bad, T)).toThrow(ControlConfigError);
  });
  it('rejects unsafe timing', () => {
    expect(validateTiming({ ...T, yellow: 1 }).join()).toMatch(/yellow/);
    expect(validateTiming({ ...T, allRed: 0 }).join()).toMatch(/allRed/);
    expect(validateTiming({ ...T, minGreen: 2 }).join()).toMatch(/minGreen/);
    expect(validateTiming({ ...T, minGreen: 30, maxGreen: 20 }).join()).toMatch(/maxGreen/);
    expect(() => new SignalStateMachine(TWO_PHASE_PLAN, { ...T, yellow: 0 })).toThrow(ControlConfigError);
  });
  it('detects conflicting signal states', () => {
    expect(conflictingGreens({ N: 'green', S: 'green', E: 'red', W: 'red' })).toEqual([]);
    expect(conflictingGreens({ N: 'green', S: 'red', E: 'yellow', W: 'red' })).toEqual([['N', 'E']]);
    expect(conflictingGreens({ N: 'red', S: 'red', E: 'red', W: 'red' })).toEqual([]);
  });
});

describe('signal state machine transitions', () => {
  it('starts green on the first phase with only that road green', () => {
    const m = new SignalStateMachine(TWO_PHASE_PLAN, T);
    expect(m.status.stage).toBe('green');
    expect(m.status.phase).toBe('NS');
    expect(m.colors).toEqual({ N: 'green', S: 'green', E: 'red', W: 'red' });
  });

  it('refuses to end a green before minGreen, then runs green -> yellow -> all-red -> green with exact durations', () => {
    const m = new SignalStateMachine(TWO_PHASE_PLAN, T);
    m.request('EW');
    const stages: string[] = [];
    for (let k = 0; k < 400; k++) {
      m.step(DT);
      const label = `${m.status.stage}:${m.status.phase}`;
      if (stages[stages.length - 1] !== label) stages.push(label);
      if (m.log.length >= 4) break;
    }
    expect(stages).toEqual(['green:NS', 'yellow:NS', 'allRed:NS', 'green:EW']);
    const [g0, y, r, g1] = m.log;
    expect(g0).toMatchObject({ type: 'green', phase: 'NS', time: 0 });
    expect(y.type).toBe('yellow');
    expect(y.time).toBeCloseTo(T.minGreen, 6); // earliest legal switch
    expect(r.time - y.time).toBeCloseTo(T.yellow, 6);
    expect(g1.time - r.time).toBeCloseTo(T.allRed, 6);
    expect(g1.phase).toBe('EW');
  });

  it('shows the right colours in each stage', () => {
    const m = new SignalStateMachine(TWO_PHASE_PLAN, T);
    m.request('EW');
    while (m.status.stage === 'green') m.step(DT);
    expect(m.colors).toEqual({ N: 'yellow', S: 'yellow', E: 'red', W: 'red' });
    expect(m.status.nextPhase).toBe('EW');
    while (m.status.stage === 'yellow') m.step(DT);
    expect(m.colors).toEqual({ N: 'red', S: 'red', E: 'red', W: 'red' });
    while (m.status.stage === 'allRed') m.step(DT);
    expect(m.colors).toEqual({ N: 'red', S: 'red', E: 'green', W: 'green' });
  });

  it('rejects unknown phases and lets a request for the current phase withdraw a pending one', () => {
    const m = new SignalStateMachine(TWO_PHASE_PLAN, T);
    expect(m.request('nope')).toBe(false);
    expect(m.stats.rejectedRequests).toBe(1);
    m.request('EW');
    m.request('NS');
    for (let k = 0; k < 400; k++) m.step(DT);
    expect(m.log.filter((e) => e.type === 'yellow')).toHaveLength(0);
  });

  it('watchdog ends a green at maxGreen even if the controller never asks', () => {
    const m = new SignalStateMachine(TWO_PHASE_PLAN, { ...T, maxGreen: 20 });
    for (let k = 0; k < Math.round(100 / DT); k++) m.step(DT);
    const firstYellow = m.log.find((e) => e.type === 'yellow')!;
    expect(firstYellow.time).toBeCloseTo(20, 6);
    expect(m.stats.watchdogSwitches).toBeGreaterThanOrEqual(2);
    expect(greenDurations(m, 'EW')[0]).toBeCloseTo(20, 6);
  });

  it('reset returns to the initial state', () => {
    const m = new SignalStateMachine(TWO_PHASE_PLAN, T);
    m.request('EW');
    for (let k = 0; k < 600; k++) m.step(DT);
    m.reset();
    expect(m.status).toMatchObject({ stage: 'green', phase: 'NS', elapsed: 0 });
    expect(m.log).toHaveLength(1);
    expect(m.stats.acceptedRequests).toBe(0);
  });

  it('can start on another phase', () => {
    const m = new SignalStateMachine(TWO_PHASE_PLAN, T, 'EW');
    expect(m.colors).toEqual({ N: 'red', S: 'red', E: 'green', W: 'green' });
    expect(() => new SignalStateMachine(TWO_PHASE_PLAN, T, 'XX')).toThrow(ControlConfigError);
  });
});

describe('safety holds against a hostile controller', () => {
  it('never shows conflicting signals or skips clearance, whatever is requested', () => {
    const rng = mulberry32(99);
    const ids = ['NS', 'EW', 'NS', 'EW', 'bogus'];
    const chaos: SignalController = {
      name: 'chaos',
      reset() {},
      decide: () => (rng() < 0.7 ? { phase: ids[Math.floor(rng() * ids.length)] } : null),
    };
    const m = new SignalStateMachine(TWO_PHASE_PLAN, T);
    const colors = drive(m, chaos, 1200);

    for (const c of colors) expect(conflictingGreens(c)).toEqual([]);

    const log = m.log;
    expect(log.length).toBeGreaterThan(30);
    for (let i = 1; i < log.length; i++) {
      const prev = log[i - 1];
      const cur = log[i];
      const span = cur.time - prev.time;
      if (prev.type === 'green') {
        expect(cur.type).toBe('yellow');
        expect(span).toBeGreaterThanOrEqual(T.minGreen - 1e-6);
        expect(span).toBeLessThanOrEqual(T.maxGreen + 1e-6);
      } else if (prev.type === 'yellow') {
        expect(cur.type).toBe('allRed');
        expect(span).toBeCloseTo(T.yellow, 6);
      } else {
        expect(cur.type).toBe('green');
        expect(span).toBeCloseTo(T.allRed, 6);
        expect(cur.phase).toBe(prev.next);
      }
    }
    expect(m.stats.rejectedRequests).toBeGreaterThan(0);
  });

  it('every colour change on an approach passes through yellow (green never jumps straight to red)', () => {
    const m = new SignalStateMachine(TWO_PHASE_PLAN, T);
    const colors = drive(m, { name: 'flip', reset() {}, decide: () => ({ phase: m.status.phase === 'NS' ? 'EW' : 'NS' }) }, 600);
    for (const a of APPROACHES) {
      for (let k = 1; k < colors.length; k++) {
        expect(!(colors[k - 1][a] === 'green' && colors[k][a] === 'red')).toBe(true);
        expect(!(colors[k - 1][a] === 'red' && colors[k][a] === 'yellow')).toBe(true);
      }
    }
  });

  it('SafetyViolation exists for the runtime invariant check', () => {
    expect(new SafetyViolation('x').message).toMatch(/safety violation/i);
  });
});

describe('fixed-time controller', () => {
  it('builds a plan for a cycle length, splitting the green that remains', () => {
    const plan = planFromCycle(TWO_PHASE_PLAN, T, 60);
    expect(plan.greens).toEqual({ NS: 25, EW: 25 });
    expect(cycleLengthOf(plan, T)).toBeCloseTo(60, 9);
    const uneven = planFromCycle(TWO_PHASE_PLAN, T, 90, { NS: 2, EW: 1 });
    expect(uneven.greens.NS).toBeCloseTo(53.3, 6);
    expect(uneven.greens.EW).toBeCloseTo(26.7, 6);
    expect(cycleLengthOf(uneven, T)).toBeCloseTo(90, 6);
  });

  it('rejects plans that break the safety timing', () => {
    expect(() => planFromCycle(TWO_PHASE_PLAN, T, 20)).toThrow(ControlConfigError);
    expect(() => planFromCycle(TWO_PHASE_PLAN, T, 60, { NS: 0 })).toThrow(ControlConfigError);
    expect(() => new FixedTimeController(TWO_PHASE_PLAN, T, { greens: { NS: 3, EW: 25 }, order: ['NS', 'EW'] })).toThrow(/minGreen/);
    expect(() => new FixedTimeController(TWO_PHASE_PLAN, T, { greens: { NS: 25 }, order: ['NS', 'EW'] })).toThrow(ControlConfigError);
    expect(() => new FixedTimeController(TWO_PHASE_PLAN, T, { greens: { NS: 90, EW: 25 }, order: ['NS', 'EW'] })).toThrow(/maxGreen/);
  });

  it('produces the planned green lengths and cycle period', () => {
    const plan = planFromCycle(TWO_PHASE_PLAN, T, 60);
    const m = new SignalStateMachine(TWO_PHASE_PLAN, T);
    const c = new FixedTimeController(TWO_PHASE_PLAN, T, plan);
    drive(m, c, 600);
    for (const d of greenDurations(m, 'NS')) expect(d).toBeCloseTo(25, 6);
    for (const d of greenDurations(m, 'EW')) expect(d).toBeCloseTo(25, 6);
    const nsStarts = m.log.filter((e) => e.type === 'green' && e.phase === 'NS').map((e) => e.time);
    for (let i = 1; i < nsStarts.length; i++) expect(nsStarts[i] - nsStarts[i - 1]).toBeCloseTo(60, 6);
    expect(m.stats.watchdogSwitches).toBe(0);
  });

  it('honours an uneven split', () => {
    const plan = planFromCycle(TWO_PHASE_PLAN, T, 90, { NS: 2, EW: 1 });
    const m = new SignalStateMachine(TWO_PHASE_PLAN, T);
    drive(m, new FixedTimeController(TWO_PHASE_PLAN, T, plan), 900);
    expect(greenDurations(m, 'NS')[0]).toBeCloseTo(53.3, 6);
    expect(greenDurations(m, 'EW')[0]).toBeCloseTo(26.7, 6);
  });

  it('is deterministic', () => {
    const run = () => {
      const m = new SignalStateMachine(TWO_PHASE_PLAN, T);
      drive(m, new FixedTimeController(TWO_PHASE_PLAN, T, planFromCycle(TWO_PHASE_PLAN, T, 70)), 500);
      return JSON.stringify(m.log);
    };
    expect(run()).toBe(run());
  });
});
