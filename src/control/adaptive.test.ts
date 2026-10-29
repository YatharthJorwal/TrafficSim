import { describe, expect, it } from 'vitest';
import type { ApproachMeasurement, Measurements } from '../detectors/types';
import { SimulationRunner } from '../runtime';
import { createConfig, uniformDemand } from '../sim/config';
import type { Approach } from '../sim/types';
import { APPROACHES } from '../sim/types';
import {
  AdaptiveController,
  ControlConfigError,
  DEFAULT_ADAPTIVE,
  DEFAULT_TIMING,
  TWO_PHASE_PLAN,
  validateAdaptiveConfig,
  type PhaseDef,
  type SignalStatus,
} from './index';

const DT = 0.05;
const blank = (): ApproachMeasurement => ({
  observed: { inZone: 0, approaching: 0, queueLength: 0, queueLengthM: 0, zoneOverflow: false, avgWait: 0, maxWait: 0, arrivals: 0, departures: 0 },
  estimated: { demandVehPerHour: 0 },
});
function meas(over: Partial<Record<Approach, Partial<ApproachMeasurement['observed']>>> = {}): Measurements {
  const m = {} as Measurements;
  for (const a of APPROACHES) {
    const b = blank();
    Object.assign(b.observed, over[a] ?? {});
    m[a] = b;
  }
  return m;
}
const green = (phase: string, elapsed: number, stage: SignalStatus['stage'] = 'green'): SignalStatus => ({
  phase, nextPhase: stage === 'green' ? null : 'EW', stage, elapsed, stageDuration: null,
  colors: { N: 'green', S: 'green', E: 'red', W: 'red' },
});
const make = (config = {}) => new AdaptiveController(TWO_PHASE_PLAN, DEFAULT_TIMING, config);
const ask = (c: AdaptiveController, signal: SignalStatus, measurements?: Measurements) => c.decide({ time: 100, dt: DT, signal, measurements });

describe('adaptive controller rules', () => {
  it('does nothing before the minimum green, outside green, or without measurements', () => {
    const c = make();
    const busyEW = meas({ E: { queueLength: 8 }, W: { queueLength: 8 } });
    expect(ask(c, green('NS', 5), busyEW)).toBeNull();
    expect(ask(c, green('NS', 30, 'yellow'), busyEW)).toBeNull();
    expect(ask(c, green('NS', 30, 'allRed'), busyEW)).toBeNull();
    expect(ask(c, green('NS', 30))).toBeNull();
    expect(c.decisions).toHaveLength(0);
  });

  it('gaps out: leaves an empty green for a phase that has a queue', () => {
    const r = ask(make(), green('NS', 20), meas({ E: { queueLength: 4 } }));
    expect(r).toMatchObject({ phase: 'EW', reason: 'gap-out' });
  });

  it('stays green while its own queue is being served and the other side is not much busier', () => {
    const c = make();
    expect(ask(c, green('NS', 20), meas({ N: { queueLength: 6 }, S: { queueLength: 5 }, E: { queueLength: 2 } }))).toBeNull();
    expect(ask(c, green('NS', 20), meas({ N: { queueLength: 3, approaching: 4 }, W: { queueLength: 3 } }))).toBeNull();
  });

  it('switches when the other phase is clearly busier', () => {
    const r = ask(make(), green('NS', 20), meas({ N: { queueLength: 2 }, S: { queueLength: 1 }, E: { queueLength: 9 }, W: { queueLength: 7 } }));
    expect(r).toMatchObject({ phase: 'EW', reason: 'higher demand' });
  });

  it('stays when nobody is waiting for the other phase', () => {
    const c = make();
    expect(ask(c, green('NS', 40), meas({ N: { queueLength: 9 } }))).toBeNull();
    expect(ask(c, green('NS', 49), meas())).toBeNull();
  });

  it('ends a green at the maximum when somebody is waiting, however busy it still is', () => {
    const heavy = meas({ N: { queueLength: 12 }, S: { queueLength: 12 }, E: { queueLength: 2 } });
    expect(ask(make(), green('NS', DEFAULT_ADAPTIVE.maxGreen - 1), heavy)).toBeNull();
    expect(ask(make(), green('NS', DEFAULT_ADAPTIVE.maxGreen), heavy)).toMatchObject({ phase: 'EW', reason: 'max green' });
  });

  it('serves a vehicle that has waited too long, even over a busy green', () => {
    const m = meas({ N: { queueLength: 12, approaching: 5 }, S: { queueLength: 10 }, W: { queueLength: 1, maxWait: DEFAULT_ADAPTIVE.maxWait } });
    expect(ask(make(), green('NS', 15), m)).toMatchObject({ phase: 'EW', reason: 'max wait' });
    // but never before the minimum green: safety and pedestrians come first
    expect(ask(make(), green('NS', 6), m)).toBeNull();
  });

  it('only ever asks for a phase that exists and is not the current one; with several phases it picks the busiest', () => {
    const three: PhaseDef[] = [
      { id: 'A', label: 'a', greens: ['N'] },
      { id: 'B', label: 'b', greens: ['E'] },
      { id: 'C', label: 'c', greens: ['S', 'W'] },
    ];
    const c = new AdaptiveController(three, DEFAULT_TIMING);
    const r = c.decide({ time: 0, dt: DT, signal: { ...green('A', 30), colors: { N: 'green', S: 'red', E: 'red', W: 'red' } }, measurements: meas({ E: { queueLength: 3 }, S: { queueLength: 4 }, W: { queueLength: 4 } }) });
    expect(r?.phase).toBe('C');
    const ns = make();
    for (let k = 0; k < 400; k++) {
      const q = (k * 7) % 11;
      const r2 = ask(ns, green(k % 2 ? 'NS' : 'EW', 12 + (k % 40)), meas({ N: { queueLength: q }, E: { queueLength: 10 - q, maxWait: (k * 13) % 100 } }));
      if (r2) {
        expect(['NS', 'EW']).toContain(r2.phase);
        expect(r2.phase).not.toBe(k % 2 ? 'NS' : 'EW');
      }
    }
  });

  it('records why it switched, and forgets on reset', () => {
    const c = make();
    ask(c, green('NS', 20), meas({ E: { queueLength: 4 } }));
    expect(c.decisions).toHaveLength(1);
    expect(c.decisions[0]).toMatchObject({ from: 'NS', to: 'EW', reason: 'gap-out' });
    expect(c.decisions[0].pressures.EW).toBeGreaterThan(c.decisions[0].pressures.NS);
    expect(c.describe()).toMatch(/NS -> EW \(gap-out\)/);
    c.reset();
    expect(c.decisions).toHaveLength(0);
    expect(c.describe()).toMatch(/no switch/);
  });

  it('refuses a configuration that would break the safety timing', () => {
    expect(validateAdaptiveConfig(DEFAULT_ADAPTIVE, DEFAULT_TIMING)).toEqual([]);
    expect(() => make({ minGreen: 4 })).toThrow(ControlConfigError);
    expect(() => make({ maxGreen: 90 })).toThrow(/watchdog/);
    expect(() => make({ minGreen: 30, maxGreen: 20 })).toThrow(ControlConfigError);
    expect(() => make({ maxWait: 10 })).toThrow(/maxWait/);
    expect(() => make({ switchRatio: 0.5 })).toThrow(/switchRatio/);
    expect(() => new AdaptiveController([TWO_PHASE_PLAN[0]], DEFAULT_TIMING)).toThrow(ControlConfigError);
  });
});

function greens(r: SimulationRunner) {
  const out: { phase: string; start: number; length: number }[] = [];
  const log = r.machine.log;
  for (let i = 0; i + 1 < log.length; i++) if (log[i].type === 'green') out.push({ phase: log[i].phase, start: log[i].time, length: log[i + 1].time - log[i].time });
  return out;
}
function runAdaptive(opts: { N?: number; E?: number; seed?: number; seconds?: number; mode?: 'arrivals' | 'circulating'; fleet?: number }) {
  const config = createConfig({ seed: opts.seed ?? 4, duration: opts.seconds ?? 900, mode: opts.mode ?? 'arrivals', fleet: opts.fleet ?? 40 });
  config.demand = uniformDemand(0);
  for (const a of APPROACHES) config.demand[a] = { ratePerHour: a === 'N' || a === 'S' ? (opts.N ?? 500) : (opts.E ?? 120), turnMix: { left: 0.2, straight: 0.6, right: 0.2 } };
  const r = new SimulationRunner(config, new AdaptiveController(TWO_PHASE_PLAN, DEFAULT_TIMING), { diagnostics: true });
  r.run(config.duration);
  return r;
}

describe('adaptive controller in the running system', () => {
  it('keeps every green inside its limits and the junction safe', () => {
    const r = runAdaptive({ N: 600, E: 150 });
    const g = greens(r).slice(0, -1);
    expect(g.length).toBeGreaterThan(10);
    for (const x of g) {
      expect(x.length).toBeGreaterThanOrEqual(DEFAULT_ADAPTIVE.minGreen - 0.1); // also keeps the pedestrian crossing window
      expect(x.length).toBeLessThanOrEqual(DEFAULT_ADAPTIVE.maxGreen + 0.1);
    }
    expect(r.machine.stats.rejectedRequests).toBe(0);
    expect(r.machine.stats.watchdogSwitches).toBe(0);
    const s = r.engine.stats;
    expect(s.overlapPairSteps).toBe(0);
    expect(s.safetyClamps).toBe(0);
    expect(s.redLightEntries).toBe(0);
  });

  it('gives more green to the busier road', () => {
    const r = runAdaptive({ N: 650, E: 120, seconds: 1200 });
    const g = greens(r).slice(0, -1);
    const total = (p: string) => g.filter((x) => x.phase === p).reduce((n, x) => n + x.length, 0);
    expect(total('NS')).toBeGreaterThan(1.4 * total('EW'));
  });

  it('does not starve a quiet road', () => {
    const r = runAdaptive({ N: 750, E: 70, seconds: 1500 });
    const ew = greens(r).filter((x) => x.phase === 'EW');
    expect(ew.length).toBeGreaterThan(8);
    for (let i = 1; i < ew.length; i++) expect(ew[i].start - ew[i - 1].start).toBeLessThan(DEFAULT_ADAPTIVE.maxWait + DEFAULT_ADAPTIVE.maxGreen + 15);
    for (const a of ['E', 'W'] as const) expect(r.detectors.totals(a).peakWait).toBeLessThan(DEFAULT_ADAPTIVE.maxWait + 25);
  });

  it('is deterministic', () => {
    const a = runAdaptive({ seed: 9, seconds: 600 });
    const b = runAdaptive({ seed: 9, seconds: 600 });
    expect(a.engine.stateKey()).toBe(b.engine.stateKey());
    expect(JSON.stringify(a.machine.log)).toBe(JSON.stringify(b.machine.log));
    expect(runAdaptive({ seed: 10, seconds: 600 }).engine.stateKey()).not.toBe(a.engine.stateKey());
  });

  it('copes with no traffic at all (the safety watchdog still turns the lights over)', () => {
    const r = runAdaptive({ N: 0, E: 0, seconds: 400 });
    expect(r.engine.vehiclesOnNetwork).toBe(0);
    expect(r.machine.stats.rejectedRequests).toBe(0);
    expect(greens(r).length).toBeGreaterThan(3);
  });

  it('is safe with a circulating fleet too', () => {
    for (const fleet of [24, 48]) {
      const r = runAdaptive({ mode: 'circulating', fleet, seconds: 900 });
      const s = r.engine.stats;
      expect(s.overlapPairSteps, `fleet ${fleet}`).toBe(0);
      expect(s.safetyClamps).toBe(0);
      expect(s.redLightEntries).toBe(0);
      expect(r.engine.vehiclesOnNetwork).toBe(fleet);
      expect(r.engine.completed.filter((c) => c.exitedAt > 600).length).toBeGreaterThan(30);
    }
  }, 120000);
});
