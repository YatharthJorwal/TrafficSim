import { describe, expect, it } from 'vitest';
import { ConfigError, MAX_FLEET, createConfig, validateConfig } from './config';
import { simpleCycle } from './debugSignals';
import { SimulationEngine } from './engine';
import { GEOMETRY, NETWORK, RING_PATH, poseAt } from './network';
import { SPAWN_INTERVAL, generateSchedule } from './schedule';
import { APPROACHES } from './types';

const circ = (fleet: number, seed = 1, extra: Parameters<typeof createConfig>[0] = {}) =>
  createConfig({ mode: 'circulating', fleet, seed, duration: 900, ...extra });

function drive(cfg: ReturnType<typeof circ>, until: number, green = 25, diagnostics = true) {
  const e = new SimulationEngine(cfg, { diagnostics });
  while (e.time < until) {
    e.setSignals(simpleCycle(e.time, green));
    e.step();
  }
  return e;
}
const angDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

describe('ring road geometry', () => {
  const connectors = NETWORK.routes.filter((r) => r.kind === 'connector');
  const mains = NETWORK.routes.filter((r) => r.kind === 'main');

  it('has 12 main routes first, then one connector per (exit arm, target arm)', () => {
    expect(mains.length).toBe(12);
    expect(connectors.length).toBe(16);
    NETWORK.routes.forEach((r, i) => expect(r.index).toBe(i));
    expect(NETWORK.routes.slice(0, 12).every((r) => r.kind === 'main')).toBe(true);
    for (const a of APPROACHES) for (const b of APPROACHES) expect(NETWORK.connector(a, b).id).toBe(`C-${a}-${b}`);
  });

  it('joins up exactly: every main route flows into its connectors, and connectors into the next arm', () => {
    for (const c of connectors) {
      for (const m of mains.filter((r) => r.exit === c.exit)) {
        const end = poseAt(m, m.length - 1e-4);
        const start = poseAt(c, 0);
        expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeLessThan(0.01);
        expect(angDiff(end.heading, start.heading)).toBeLessThan(0.1);
      }
      for (const m of mains.filter((r) => r.approach === c.approach)) {
        const end = poseAt(c, c.length - 1e-4);
        const start = poseAt(m, 0);
        expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeLessThan(0.01);
        expect(angDiff(end.heading, start.heading)).toBeLessThan(0.1);
      }
    }
  });

  it('is a closed clockwise loop made of right turns only, at the expected distance', () => {
    const { points, length } = RING_PATH;
    expect(points[0]).toEqual(points[points.length - 1]);
    expect(length).toBeGreaterThan(800);
    expect(length).toBeLessThan(830);
    for (const c of connectors) {
      for (let i = 2; i < c.points.length; i++) {
        const a = c.points[i - 2], b = c.points[i - 1], d = c.points[i];
        expect((b.x - a.x) * (d.y - b.y) - (b.y - a.y) * (d.x - b.x)).toBeLessThan(1e-9); // never turns left
      }
      for (const p of c.points) expect(Math.max(Math.abs(p.x), Math.abs(p.y))).toBeLessThanOrEqual(GEOMETRY.armLength + 6 + 1e-9);
    }
    for (const a of APPROACHES) expect(RING_PATH.uMerge[a] - RING_PATH.uTurn[a]).toBeCloseTo(2 * (GEOMETRY.laneOffset + 6), 6);
  });

  it('gives sensible connector lengths and speed limits', () => {
    expect(NETWORK.connector('N', 'E').length).toBeLessThan(260); // next arm clockwise
    expect(NETWORK.connector('N', 'N').length).toBeGreaterThan(RING_PATH.length); // all the way round
    for (const c of connectors) {
      expect(c.ringStartS).toBeGreaterThan(8);
      expect(c.ringEndS).toBeGreaterThan(c.ringStartS);
      expect(c.length - c.ringEndS).toBeGreaterThan(8);
      expect(c.limits.length).toBeGreaterThanOrEqual(3);
      expect(c.stopLineS).toBe(Infinity);
    }
  });
});

describe('config', () => {
  it('validates mode and fleet', () => {
    expect(validateConfig(circ(40))).toEqual([]);
    expect(validateConfig(createConfig())).toEqual([]);
    expect(validateConfig(circ(MAX_FLEET + 1)).join()).toMatch(/fleet/);
    expect(validateConfig(circ(-1)).join()).toMatch(/fleet/);
    expect(validateConfig(circ(2.5)).join()).toMatch(/fleet/);
    expect(validateConfig({ ...circ(10), mode: 'loop' as never }).join()).toMatch(/mode/);
    expect(() => new SimulationEngine(circ(MAX_FLEET + 5))).toThrow(ConfigError);
  });
});

describe('fleet schedule', () => {
  it('places vehicles round robin at the four fixed entries, staggered in time', () => {
    const s = generateSchedule(circ(10));
    expect(s.length).toBe(10);
    s.forEach((a, i) => {
      expect(a.id).toBe(i + 1);
      expect(a.approach).toBe(APPROACHES[i % 4]);
      expect(a.time).toBeCloseTo(Math.floor(i / 4) * SPAWN_INTERVAL, 9);
    });
    expect(generateSchedule(circ(10))).toEqual(s);
    expect(generateSchedule(circ(10, 2))).not.toEqual(s);
    // the arrival rates are irrelevant in this mode
    expect(generateSchedule(circ(10, 1, { demand: { N: { ratePerHour: 1500 } } }))).toEqual(s);
  });
});

describe('persistent vehicles', () => {
  it('never removes a vehicle: the whole fleet stays on the network and keeps circulating', () => {
    const e = new SimulationEngine(circ(40), { diagnostics: false });
    const ids = new Set<number>();
    for (let k = 0; k < 600 / 0.05; k++) {
      e.setSignals(simpleCycle(e.time));
      e.step();
      if (e.time > 30 && k % 40 === 0) {
        expect(e.vehiclesOnNetwork).toBe(40);
        expect(e.stats.generated).toBe(40);
        expect(APPROACHES.reduce((n, a) => n + e.backlogCount(a), 0)).toBe(0);
      }
    }
    for (const r of e.completed) ids.add(r.id);
    expect(ids.size).toBe(40); // everyone has gone round at least once
    const perVehicle = new Map<number, number>();
    for (const r of e.completed) perVehicle.set(r.id, (perVehicle.get(r.id) ?? 0) + 1);
    expect(Math.max(...perVehicle.values())).toBeGreaterThanOrEqual(3);
    expect(e.stats.exited).toBeGreaterThan(100);
    const obs = e.observe();
    expect(obs.every((o) => o.persistent)).toBe(true);
    expect(obs.some((o) => o.leg >= 2)).toBe(true);
  });

  it('leaves arrivals mode exactly as it was (vehicles still leave; not persistent)', () => {
    const e = new SimulationEngine(createConfig({ seed: 3, duration: 300 }));
    e.run(120);
    expect(e.observe().every((o) => !o.persistent && o.leg === 0)).toBe(true);
    expect(e.isCirculating).toBe(false);
    expect(() => e.addVehicles(5)).toThrow();
  });
});

describe('safety on the ring (fixed-time signals)', () => {
  for (const fleet of [20, 40, MAX_FLEET]) {
    it(`fleet ${fleet}: no overlaps, no guard hits, safe gaps, still flowing`, () => {
      for (const seed of [1, 2]) {
        const e = drive(circ(fleet, seed), 900);
        const s = e.stats;
        expect(s.overlapPairSteps, `seed ${seed} ${JSON.stringify(s.firstOverlap)} ${e.clampSamples[0] ?? ''}`).toBe(0);
        expect(s.safetyClamps).toBe(0);
        expect(s.minGap).toBeGreaterThan(1.0);
        expect(s.redLightEntries).toBe(0);
        expect(e.vehiclesOnNetwork).toBe(fleet);
        expect(e.completed.filter((c) => c.exitedAt > 600).length, `seed ${seed}`).toBeGreaterThan(30);
      }
    }, 120000);
  }

  it('holds up under very different signal timings', () => {
    for (const green of [8, 15, 45]) {
      const e = drive(circ(40, 3), 600, green);
      expect(e.stats.overlapPairSteps, `green ${green}`).toBe(0);
      expect(e.stats.safetyClamps).toBe(0);
      expect(e.completed.filter((c) => c.exitedAt > 400).length, `green ${green}`).toBeGreaterThan(20);
    }
  }, 120000);
});

describe('determinism and fairness', () => {
  it('is reproducible, seed-sensitive, and reset restores the start', () => {
    const a = drive(circ(30), 200, 25, false);
    const b = drive(circ(30), 200, 25, false);
    expect(a.stateKey()).toBe(b.stateKey());
    expect(drive(circ(30, 2), 200, 25, false).stateKey()).not.toBe(a.stateKey());
    const fresh = new SimulationEngine(circ(30));
    a.reset();
    expect(a.stateKey()).toBe(fresh.stateKey());
    expect(a.fleetSize).toBe(30);
  });

  it('gives every controller the same vehicles and the same route choices per vehicle', () => {
    const legs = (green: number) => {
      const e = drive(circ(16, 5), 400, green, false);
      const byId = new Map<number, string[]>();
      for (const r of e.completed) byId.set(r.id, [...(byId.get(r.id) ?? []), `${r.approach}-${r.movement}`]);
      return byId;
    };
    const slow = legs(40);
    const fast = legs(12);
    let compared = 0;
    for (const [id, seq] of slow) {
      const other = fast.get(id)!;
      const n = Math.min(seq.length, other.length, 3);
      expect(other.slice(0, n)).toEqual(seq.slice(0, n));
      compared += n;
    }
    expect(compared).toBeGreaterThan(30);
    expect(slow.size).toBe(16);
  });
});

describe('adding vehicles live', () => {
  it('spawns more vehicles at the four fixed entries, up to the cap', () => {
    const e = new SimulationEngine(circ(20), { diagnostics: true });
    const run = (until: number) => {
      while (e.time < until) {
        e.setSignals(simpleCycle(e.time));
        e.step();
      }
    };
    run(60);
    const before = APPROACHES.map((a) => e.stats.perApproach[a].inserted);
    expect(e.addVehicles(12)).toBe(12);
    expect(e.fleetSize).toBe(32);
    run(120);
    expect(e.vehiclesOnNetwork).toBe(32);
    expect(e.stats.generated).toBe(32);
    const after = APPROACHES.map((a) => e.stats.perApproach[a].inserted);
    after.forEach((n, i) => expect(n - before[i]).toBe(3)); // 12 vehicles over 4 entries
    expect(e.stats.overlapPairSteps).toBe(0);
    expect(e.stats.safetyClamps).toBe(0);
    expect(new Set(e.observe().map((o) => o.id)).size).toBe(32);
    expect(e.addVehicles(0)).toBe(0);
    expect(e.addVehicles(-4)).toBe(0);
    expect(e.addVehicles(1000)).toBe(MAX_FLEET - 32);
    expect(e.fleetSize).toBe(MAX_FLEET);
    expect(e.addVehicles(1)).toBe(0);
    run(200);
    expect(e.vehiclesOnNetwork).toBe(MAX_FLEET);
    expect(e.stats.overlapPairSteps).toBe(0);
  }, 60000);
});
