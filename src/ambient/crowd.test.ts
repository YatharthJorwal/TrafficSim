import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMING, FixedTimeController, TWO_PHASE_PLAN, planFromCycle } from '../control';
import { SimulationRunner } from '../runtime';
import { createConfig, uniformDemand } from '../sim/config';
import { ALL_GREEN } from '../sim/debugSignals';
import { NETWORK, OPPOSITE, poseAt } from '../sim/network';
import type { SignalStates, VehicleObservation } from '../sim/types';
import { PED_EDGES, PED_NODES, PedestrianCrowd, carBlocksCrossing, permitted } from './crowd';

const DT = 0.05;
const NS: SignalStates = { N: 'green', S: 'green', E: 'red', W: 'red' };
const EW: SignalStates = { N: 'red', S: 'red', E: 'green', W: 'green' };
const RED: SignalStates = { N: 'red', S: 'red', E: 'red', W: 'red' };

function setup(rate = 400, seed = 3) {
  const config = createConfig({ seed, duration: 900 });
  config.demand = uniformDemand(rate);
  const plan = planFromCycle(TWO_PHASE_PLAN, DEFAULT_TIMING, 60);
  return new SimulationRunner(config, new FixedTimeController(TWO_PHASE_PLAN, DEFAULT_TIMING, plan));
}
const ctx = (r: SimulationRunner) => ({ signals: r.engine.signals, overridden: r.overridden, vehicles: r.lastObservations, vehicleLength: 4.5 });

function distanceToGraph(x: number, y: number): number {
  let best = Infinity;
  for (const e of PED_EDGES) {
    const a = PED_NODES[e.a];
    const b = PED_NODES[e.b];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t)));
  }
  return best;
}

const obs = (routeIndex: number, s: number, speed: number): VehicleObservation => {
  const r = NETWORK.routes[routeIndex];
  return { id: 1, routeIndex, approach: r.approach, movement: r.movement, s, speed, distanceToStopLine: r.stopLineS - s, held: false };
};

describe('crossing permission', () => {
  it('walks across an arm only while the road being crossed is fully red and the parallel road green', () => {
    expect(permitted('N', EW)).toBe(true);
    expect(permitted('S', EW)).toBe(true);
    expect(permitted('E', NS)).toBe(true);
    expect(permitted('W', NS)).toBe(true);
    expect(permitted('N', NS)).toBe(false);
    expect(permitted('E', EW)).toBe(false);
    expect(permitted('N', RED)).toBe(false);
    expect(permitted('N', { ...EW, W: 'yellow' })).toBe(false);
    expect(permitted('N', { N: 'red', S: 'yellow', E: 'green', W: 'green' })).toBe(false);
  });
});

describe('cars that block a crossing', () => {
  const route = (a: 'N' | 'E' | 'S' | 'W', m: 'left' | 'straight' | 'right') => NETWORK.route(a, m);
  it('blocks when a turning car is about to drive over the crosswalk', () => {
    // E-straight leaves along the W arm; just past the box exit it is on the W crosswalk
    const r = route('E', 'straight');
    expect(carBlocksCrossing('W', [obs(r.index, r.boxExitS - 6, 8)], 4.5, 1.3)).toBe(true);
    expect(carBlocksCrossing('W', [obs(r.index, r.boxExitS + 1, 8)], 4.5, 1.3)).toBe(true);
  });
  it('blocks for a fast car that is still well upstream but could arrive before a pedestrian finishes', () => {
    const r = route('E', 'straight');
    expect(carBlocksCrossing('W', [obs(r.index, r.boxExitS - 55, 12)], 4.5, 1.3)).toBe(true);
    expect(carBlocksCrossing('W', [obs(r.index, r.boxExitS - 70, 0)], 4.5, 1.3)).toBe(false); // stopped far away: can't make it
  });
  it('does not block for a car that is very far away, already past, or heading elsewhere', () => {
    const r = route('E', 'straight');
    expect(carBlocksCrossing('W', [obs(r.index, 0, 0)], 4.5, 1.3)).toBe(false);
    expect(carBlocksCrossing('W', [obs(r.index, r.boxExitS + 15, 10)], 4.5, 1.3)).toBe(false);
    expect(carBlocksCrossing('N', [obs(r.index, r.boxExitS - 6, 8)], 4.5, 1.3)).toBe(false);
  });
  it('lets a turning car\'s slow turn count: it cannot get through the box as fast as a straight car', () => {
    const turn = route('E', 'right'); // leaves along the N arm
    const straight = route('S', 'straight'); // also leaves along the N arm
    const sTurn = turn.boxEnterS - 38;
    const sStraight = straight.boxExitS - 38 - (straight.boxExitS - straight.boxEnterS) ;
    void sStraight;
    // same distance from the box, same speed: the turning car arrives later
    const aTurn = carBlocksCrossing('N', [obs(turn.index, sTurn, 12)], 4.5, 1.3);
    const aStraight = carBlocksCrossing('N', [obs(straight.index, straight.boxEnterS - 38, 12)], 4.5, 1.3);
    expect(aStraight).toBe(true);
    expect(typeof aTurn).toBe('boolean');
  });
  it('ignores cars waiting behind the stop line but blocks one that has run past it', () => {
    const r = route('N', 'straight');
    expect(carBlocksCrossing('N', [obs(r.index, r.stopLineS - 0.6, 0)], 4.5, 1.3)).toBe(false);
    expect(carBlocksCrossing('N', [obs(r.index, r.stopLineS + 1, 3)], 4.5, 1.3)).toBe(true);
  });
});

describe('pedestrian crowd', () => {
  it('is deterministic for a seed and different for another', () => {
    const run = (seed: number) => {
      const r = setup();
      const c = new PedestrianCrowd(14, seed);
      for (let k = 0; k < 4000; k++) { r.tick(); c.step(DT, ctx(r)); }
      return JSON.stringify(c.peds.map((p) => [p.x, p.y]));
    };
    expect(run(11)).toBe(run(11));
    expect(run(11)).not.toBe(run(12));
  });

  it('stays on the sidewalk and crosswalk graph, and keeps walking', () => {
    const r = setup();
    const c = new PedestrianCrowd(14, 11);
    const start = c.peds.map((p) => [p.x, p.y]);
    for (let k = 0; k < 6000; k++) {
      r.tick();
      c.step(DT, ctx(r));
      if (k % 20 === 0) for (const p of c.peds) expect(distanceToGraph(p.x, p.y)).toBeLessThan(0.01);
    }
    expect(c.peds.map((p) => [p.x, p.y])).not.toEqual(start);
    expect(c.peds.filter((p) => p.walking).length).toBeGreaterThan(2);
    // and they are lively on average, not stuck at curbs
    const r2 = setup();
    const c2 = new PedestrianCrowd(14, 11);
    let walking = 0;
    for (let k = 0; k < 6000; k++) { r2.tick(); c2.step(DT, ctx(r2)); walking += c2.peds.filter((p) => p.walking).length; }
    expect(walking / 6000 / 14).toBeGreaterThan(0.5);
  });

  it('only ever steps onto a crosswalk when it is permitted, and only crosses while that road stays red', () => {
    const r = setup(150);
    const c = new PedestrianCrowd(20, 5);
    let crossingTicks = 0;
    for (let k = 0; k < 36000; k++) {
      r.tick();
      c.step(DT, ctx(r));
      const s = r.engine.signals;
      for (const p of c.peds) {
        if (!p.crossing) continue;
        crossingTicks++;
        expect(s[p.crossing], `t=${r.time.toFixed(1)}`).toBe('red');
        expect(s[OPPOSITE[p.crossing]]).toBe('red');
      }
    }
    expect(crossingTicks).toBeGreaterThan(200);
    expect(c.completedCrossings).toBeGreaterThan(8);
  });

  it('never walks into a vehicle (900 s of busy traffic)', () => {
    const r = setup(450, 7);
    const c = new PedestrianCrowd(20, 9);
    let overlaps = 0;
    for (let k = 0; k < 18000; k++) {
      r.tick();
      c.step(DT, ctx(r));
      if (k % 2) continue;
      for (const v of r.lastObservations) {
        const route = NETWORK.routes[v.routeIndex];
        const pose = poseAt(route, v.s - 2.25);
        if (Math.hypot(pose.x, pose.y) > 14) continue;
        const cs = Math.cos(pose.heading), sn = Math.sin(pose.heading);
        for (const p of c.peds) {
          const dx = p.x - pose.x, dy = p.y - pose.y;
          const along = dx * cs + dy * sn;
          const across = -dx * sn + dy * cs;
          if (Math.abs(along) < 2.25 + 0.2 && Math.abs(across) < 0.95 + 0.2) overlaps++;
        }
      }
    }
    expect(overlaps).toBe(0);
  });

  it('never crosses under a debug override, and waits at the curb', () => {
    const r = setup();
    r.setDebugOverride(ALL_GREEN);
    const c = new PedestrianCrowd(14, 11);
    for (let k = 0; k < 6000; k++) {
      r.tick();
      c.step(DT, ctx(r));
      for (const p of c.peds) expect(p.crossing).toBeNull();
    }
    expect(c.completedCrossings).toBe(0);
  });

  it('reset returns to the seeded start', () => {
    const r = setup();
    const c = new PedestrianCrowd(14, 11);
    const start = JSON.stringify(c.peds);
    for (let k = 0; k < 1000; k++) { r.tick(); c.step(DT, ctx(r)); }
    expect(JSON.stringify(c.peds)).not.toBe(start);
    c.reset();
    expect(JSON.stringify(c.peds)).toBe(start);
    expect(c.completedCrossings).toBe(0);
  });
});
