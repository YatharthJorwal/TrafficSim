import { describe, expect, it } from 'vitest';
import { ConfigError, createConfig, uniformDemand, validateConfig } from './config';
import { SimulationEngine } from './engine';
import { GEOMETRY, NETWORK, poseAt } from './network';
import { deriveSeed, mulberry32 } from './rng';
import { generateSchedule } from './schedule';
import { ALL_GREEN, ALL_RED, simpleCycle } from './debugSignals';
import { APPROACHES, type Approach } from './types';

const route = (a: Approach, m: 'left' | 'straight' | 'right') => NETWORK.route(a, m);

describe('rng', () => {
  it('is reproducible and seed-sensitive', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const sa = Array.from({ length: 5 }, a);
    expect(Array.from({ length: 5 }, b)).toEqual(sa);
    expect(Array.from({ length: 5 }, c)).not.toEqual(sa);
    sa.forEach((x) => expect(x >= 0 && x < 1).toBe(true));
  });
  it('derives distinct streams', () => {
    const seeds = new Set([0, 1, 2, 3].map((i) => deriveSeed(7, i)));
    expect(seeds.size).toBe(4);
  });
});

describe('config validation', () => {
  it('accepts the defaults', () => {
    expect(validateConfig(createConfig())).toEqual([]);
  });
  it('rejects bad values with readable messages and throws ConfigError from the engine', () => {
    const bad = createConfig({ dt: 0, duration: -5, demand: { N: { ratePerHour: -1 }, E: { turnMix: { left: 0, straight: 0, right: 0 } } } });
    const issues = validateConfig(bad);
    expect(issues.join('\n')).toMatch(/dt/);
    expect(issues.join('\n')).toMatch(/duration/);
    expect(issues.join('\n')).toMatch(/demand\.N\.ratePerHour/);
    expect(issues.join('\n')).toMatch(/demand\.E\.turnMix/);
    expect(() => new SimulationEngine(bad)).toThrow(ConfigError);
  });
  it('rejects NaN and absurd vehicle parameters', () => {
    const bad = createConfig({ vehicle: { maxDecel: 1, comfortDecel: 2, freeSpeed: Number.NaN } });
    expect(validateConfig(bad).length).toBeGreaterThanOrEqual(2);
  });
});

describe('network geometry', () => {
  it('drives on the right and has the expected lengths', () => {
    expect(poseAt(route('N', 'straight'), 0).x).toBeCloseTo(-GEOMETRY.laneOffset); // southbound, west side
    expect(poseAt(route('S', 'straight'), 0).x).toBeCloseTo(GEOMETRY.laneOffset);
    expect(poseAt(route('E', 'straight'), 0).y).toBeCloseTo(GEOMETRY.laneOffset);
    expect(poseAt(route('W', 'straight'), 0).y).toBeCloseTo(-GEOMETRY.laneOffset);
    expect(route('N', 'straight').length).toBeCloseTo(2 * GEOMETRY.armLength);
    expect(route('N', 'left').exit).toBe('E');
    expect(route('N', 'right').exit).toBe('W');
    expect(route('N', 'straight').exit).toBe('S');
  });
  it('places the stop line before the box', () => {
    for (const r of NETWORK.routes.filter((x) => x.kind === 'main')) {
      expect(r.stopLineS).toBeLessThan(r.boxEnterS);
      expect(r.boxEnterS).toBeLessThan(r.boxExitS);
    }
  });
  it('classifies conflicts', () => {
    const k = (a: ReturnType<typeof route>, b: ReturnType<typeof route>) => NETWORK.conflicts[a.index][b.index];
    expect(k(route('N', 'straight'), route('E', 'straight'))).toBe('crossing');
    expect(k(route('N', 'straight'), route('S', 'straight'))).toBe('none');
    expect(k(route('N', 'left'), route('S', 'straight'))).toBe('crossing');
    expect(k(route('N', 'right'), route('E', 'straight'))).toBe('merging');
    expect(k(route('N', 'left'), route('N', 'straight'))).toBe('none');
    // symmetric
    for (const a of NETWORK.routes) for (const b of NETWORK.routes) expect(k(a, b)).toBe(k(b, a));
  });
});

describe('arrival schedule', () => {
  it('is deterministic, sorted and approximately matches the demand', () => {
    const cfg = createConfig({ seed: 5, duration: 3600, demand: { N: { ratePerHour: 600 }, E: { ratePerHour: 0 } } });
    const s1 = generateSchedule(cfg);
    const s2 = generateSchedule(cfg);
    expect(s1).toEqual(s2);
    for (let i = 1; i < s1.length; i++) expect(s1[i].time).toBeGreaterThanOrEqual(s1[i - 1].time);
    const n = s1.filter((a) => a.approach === 'N').length;
    expect(n).toBeGreaterThan(600 * 0.85);
    expect(n).toBeLessThan(600 * 1.15);
    expect(s1.some((a) => a.approach === 'E')).toBe(false);
    const sf = cfg.speedVariation;
    s1.forEach((a) => expect(a.speedFactor >= 1 - sf && a.speedFactor <= 1 + sf).toBe(true));
  });
  it('is independent between approaches and changes with the seed', () => {
    const base = createConfig({ seed: 9, duration: 600 });
    const changed = createConfig({ seed: 9, duration: 600, demand: { W: { ratePerHour: 1500 } } });
    const pick = (cfg: typeof base, a: Approach) => generateSchedule(cfg).filter((x) => x.approach === a).map((x) => [x.time, x.movement]);
    expect(pick(changed, 'N')).toEqual(pick(base, 'N'));
    expect(pick(changed, 'W')).not.toEqual(pick(base, 'W'));
    const other = createConfig({ seed: 10, duration: 600 });
    expect(pick(other, 'N')).not.toEqual(pick(base, 'N'));
  });
  it('respects the turn mix', () => {
    const cfg = createConfig({ seed: 3, duration: 7200, demand: { N: { ratePerHour: 1000, turnMix: { left: 1, straight: 0, right: 0 } } } });
    const n = generateSchedule(cfg).filter((a) => a.approach === 'N');
    expect(n.every((a) => a.movement === 'left')).toBe(true);
  });
});

describe('engine determinism and fixed timestep', () => {
  const cfg = createConfig({ seed: 11, duration: 300, demand: { N: { ratePerHour: 700 }, S: { ratePerHour: 700 }, E: { ratePerHour: 500 }, W: { ratePerHour: 500 } } });
  const runWith = (c: typeof cfg) => {
    const e = new SimulationEngine(c);
    while (e.time < 300) {
      e.setSignals(simpleCycle(e.time));
      e.step();
    }
    return e;
  };
  it('same seed and config give bit-identical state', () => {
    expect(runWith(cfg).stateKey()).toBe(runWith(cfg).stateKey());
  });
  it('a different seed gives a different outcome', () => {
    expect(runWith({ ...cfg, seed: 12 }).stateKey()).not.toBe(runWith(cfg).stateKey());
  });
  it('advances by exactly dt per step (no drift) and reset restores the start', () => {
    const e = new SimulationEngine(cfg);
    for (let i = 0; i < 2000; i++) e.step();
    expect(e.time).toBeCloseTo(2000 * cfg.dt, 9);
    const key0 = new SimulationEngine(cfg).stateKey();
    e.reset();
    expect(e.time).toBe(0);
    expect(e.stateKey()).toBe(key0);
    expect(e.stats.generated).toBe(0);
  });
  it('step-by-step and run() agree', () => {
    const a = new SimulationEngine(cfg);
    const b = new SimulationEngine(cfg);
    a.run(120);
    for (let i = 0; i < 2400; i++) b.step();
    expect(a.stateKey()).toBe(b.stateKey());
  });
});

describe('red-light stopping and queue discharge', () => {
  const cfg = createConfig({
    seed: 2,
    duration: 120,
    demand: { N: { ratePerHour: 900, turnMix: { left: 0, straight: 1, right: 0 } }, E: { ratePerHour: 0 }, S: { ratePerHour: 0 }, W: { ratePerHour: 0 } },
  });
  it('holds every vehicle behind the stop line on a steady red and forms a queue', () => {
    const e = new SimulationEngine(cfg, { signals: ALL_RED, diagnostics: true });
    e.run(120);
    const r = route('N', 'straight');
    expect(e.stats.enteredIntersection).toBe(0);
    expect(e.stats.redLightEntries).toBe(0);
    const snap = e.snapshot().vehicles;
    expect(snap.length).toBeGreaterThan(5);
    // The queue head sits at the stop line, everyone else is behind it with positive gaps.
    const ys = snap.map((v) => v.y).sort((a, b) => a - b); // southbound: smaller y = closer to centre
    expect(ys[0]).toBeGreaterThan(r.stopLineS ? GEOMETRY.stopLineDist - 0.2 : 0);
    expect(e.stats.minGap).toBeGreaterThan(1.0);
    expect(e.stats.overlapPairSteps).toBe(0);
    expect(snap.filter((v) => v.speed < 0.1).length).toBeGreaterThan(3);
  });
  it('discharges the queue at a plausible saturation flow once green', () => {
    const e = new SimulationEngine(cfg, { signals: ALL_RED, diagnostics: true });
    e.run(120);
    const queued = e.vehiclesOnNetwork;
    e.setSignals(ALL_GREEN);
    const before = e.stats.enteredIntersection;
    e.run(150);
    const crossed = e.stats.enteredIntersection - before;
    // First 30 s of green after a standing start: roughly 0.4-0.6 veh/s.
    expect(crossed).toBeGreaterThanOrEqual(Math.min(queued, 10));
    expect(e.stats.safetyClamps).toBe(0);
    expect(e.stats.redLightEntries).toBe(0);
  });
  it('stops for a signal that turns red while vehicles are approaching', () => {
    const e = new SimulationEngine(cfg, { signals: ALL_GREEN, diagnostics: true });
    e.run(60);
    e.setSignals({ N: 'yellow', E: 'red', S: 'red', W: 'red' });
    e.run(63);
    e.setSignals(ALL_RED);
    const entered = e.stats.enteredIntersection;
    e.run(115);
    expect(e.stats.redLightEntries).toBe(0);
    expect(e.stats.enteredIntersection).toBe(entered);
  });
});

describe('collision avoidance and vehicle counting under a signal cycle', () => {
  const heavy = createConfig({ seed: 21, duration: 900, demand: Object.fromEntries(APPROACHES.map((a) => [a, { ratePerHour: 700, turnMix: { left: 0.3, straight: 0.4, right: 0.3 } }])) as never });
  const drive = (cfg: typeof heavy, until: number) => {
    const e = new SimulationEngine(cfg, { diagnostics: true });
    while (e.time < until) {
      e.setSignals(simpleCycle(e.time));
      e.step();
    }
    return e;
  };
  it('never overlaps bodies, never needs the guard, never runs a red', () => {
    const e = drive(heavy, 900);
    expect(e.stats.overlapPairSteps, JSON.stringify(e.stats.firstOverlap)).toBe(0);
    expect(e.stats.safetyClamps).toBe(0);
    expect(e.stats.redLightEntries).toBe(0);
    expect(e.stats.minGap).toBeGreaterThan(0.5);
    expect(e.stats.exited).toBeGreaterThan(150);
  });
  it('keeps speed and acceleration inside physical bounds', () => {
    const e = drive(heavy, 600);
    const p = heavy.vehicle;
    expect(e.stats.maxSpeed).toBeLessThanOrEqual(p.freeSpeed * (1 + heavy.speedVariation) + 0.5);
    expect(e.stats.maxAccel).toBeLessThanOrEqual(p.maxAccel + 1e-9);
    expect(e.stats.maxDecel).toBeLessThanOrEqual(p.maxDecel + 1e-9);
  });
  it('counts vehicles consistently and drains completely', () => {
    const light = createConfig({ seed: 4, duration: 300, demand: Object.fromEntries(APPROACHES.map((a) => [a, { ratePerHour: 300 }])) as never });
    const e = drive(light, 300);
    const s = e.stats;
    const backlog = APPROACHES.reduce((n, a) => n + e.backlogCount(a), 0);
    expect(s.generated).toBe(e.schedule.length);
    expect(s.generated).toBe(s.inserted + backlog);
    expect(s.inserted).toBe(s.exited + e.vehiclesOnNetwork);
    expect(s.exited).toBeLessThanOrEqual(s.enteredIntersection);
    expect(s.enteredIntersection).toBeLessThanOrEqual(s.inserted);
    // Per-approach counters add up to the totals.
    for (const k of ['generated', 'inserted', 'enteredIntersection', 'exited'] as const) {
      expect(APPROACHES.reduce((n, a) => n + s.perApproach[a][k], 0)).toBe(s[k]);
    }
    // Keep running with no new arrivals: everything must leave.
    while (e.time < 900) {
      e.setSignals(simpleCycle(e.time));
      e.step();
    }
    expect(e.vehiclesOnNetwork).toBe(0);
    expect(e.stats.exited).toBe(e.schedule.length);
    expect(e.completed.length).toBe(e.schedule.length);
    for (const r of e.completed) {
      expect(r.insertedAt).toBeGreaterThanOrEqual(r.generatedAt);
      expect(r.stopLineTime).toBeGreaterThan(r.insertedAt);
      expect(r.exitedAt).toBeGreaterThan(r.stopLineTime);
      expect(r.waitingTime).toBeGreaterThanOrEqual(0);
    }
  });
  it('a left turner yields to an oncoming vehicle instead of colliding', () => {
    const cfg = createConfig({
      seed: 8,
      duration: 600,
      demand: {
        N: { ratePerHour: 600, turnMix: { left: 1, straight: 0, right: 0 } },
        S: { ratePerHour: 700, turnMix: { left: 0, straight: 1, right: 0 } },
        E: { ratePerHour: 0 },
        W: { ratePerHour: 0 },
      },
    });
    const e = new SimulationEngine(cfg, { diagnostics: true, signals: ALL_GREEN });
    e.run(600);
    expect(e.stats.overlapPairSteps).toBe(0);
    expect(e.stats.exited).toBeGreaterThan(100);
  });
});

describe('uncontrolled intersection (all green, right-of-way logic only)', () => {
  it('stays collision-free and keeps flowing without deadlock', () => {
    const cfg = createConfig({ seed: 33, duration: 600, demand: uniformDemand(350) });
    const e = new SimulationEngine(cfg, { diagnostics: true, signals: ALL_GREEN });
    e.run(600);
    expect(e.stats.overlapPairSteps, JSON.stringify(e.stats.firstOverlap)).toBe(0);
    expect(e.stats.exited).toBeGreaterThan(e.stats.generated * 0.6);
  });
});
