import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMING, FixedTimeController, TWO_PHASE_PLAN, planFromCycle } from '../control';
import { createConfig, uniformDemand } from '../sim/config';
import { NETWORK, poseAt } from '../sim/network';
import type { VehicleObservation } from '../sim/types';
import { interpolateVehicles } from './interpolate';
import { FixedStepLoop } from './loop';
import { SimulationRunner } from './runner';

const config = createConfig({ seed: 3, duration: 600 });
config.demand = uniformDemand(350);
const make = () =>
  new SimulationRunner(config, new FixedTimeController(TWO_PHASE_PLAN, DEFAULT_TIMING, planFromCycle(TWO_PHASE_PLAN, DEFAULT_TIMING, 60)));

describe('fixed-step loop', () => {
  it('reaches the same simulation state whatever the frame pacing', () => {
    const pacings: number[][] = [[1 / 60], [1 / 30], [1 / 144], [0.033, 0.007, 0.05, 0.016], [0.1]];
    for (const p of pacings) {
      const loop = new FixedStepLoop(make());
      let i = 0;
      while (loop.runner.engine.steps < 1200) loop.advance(p[i++ % p.length]);
      const reference = make();
      reference.run(loop.runner.engine.steps * config.dt);
      expect(loop.runner.engine.stateKey()).toBe(reference.engine.stateKey());
      expect(loop.runner.engine.steps).toBeGreaterThanOrEqual(1200);
    }
  });

  it('takes about speed x real time worth of steps, and none while paused', () => {
    const loop = new FixedStepLoop(make());
    loop.speed = 5;
    let steps = 0;
    for (let i = 0; i < 60; i++) steps += loop.advance(1 / 60);
    expect(steps).toBeGreaterThanOrEqual(99);
    expect(steps).toBeLessThanOrEqual(101); // 1 s * 5 = 5 s = 100 steps
    loop.running = false;
    expect(loop.advance(1)).toBe(0);
  });

  it('clamps huge frame gaps instead of spiralling', () => {
    const loop = new FixedStepLoop(make());
    expect(loop.advance(30)).toBe(Math.floor(0.1 / config.dt + 1e-9));
  });

  it('keeps alpha in [0, 1) and keeps the previous state one step behind the current one', () => {
    const loop = new FixedStepLoop(make());
    for (let i = 0; i < 400; i++) {
      loop.advance(1 / 37);
      expect(loop.alpha).toBeGreaterThanOrEqual(0);
      expect(loop.alpha).toBeLessThanOrEqual(1);
    }
    expect(loop.curr.length).toBe(loop.runner.engine.vehiclesOnNetwork);
    const before = new Map(loop.prev.map((v) => [v.id, v.s]));
    let moved = 0;
    for (const v of loop.curr) {
      const p = before.get(v.id);
      if (p !== undefined) {
        expect(v.s).toBeGreaterThanOrEqual(p - 1e-9);
        expect(v.s - p).toBeLessThan(1.0);
        moved++;
      }
    }
    expect(moved).toBeGreaterThan(0);
  });

  it('reset restarts from t = 0', () => {
    const loop = new FixedStepLoop(make());
    for (let i = 0; i < 200; i++) loop.advance(0.05);
    loop.reset();
    expect(loop.runner.engine.steps).toBe(0);
    expect(loop.curr).toHaveLength(0);
    expect(loop.alpha).toBe(0);
  });
});

describe('loop extras', () => {
  it('fastForward matches running the runner directly and refreshes what the renderer sees', () => {
    const loop = new FixedStepLoop(make());
    loop.fastForward(120);
    const ref = make();
    ref.run(120);
    expect(loop.runner.engine.stateKey()).toBe(ref.engine.stateKey());
    expect(loop.curr.length).toBe(loop.runner.engine.vehiclesOnNetwork);
    expect(loop.curr.length).toBeGreaterThan(0);
    expect(loop.alpha).toBe(0);
  });
  it('tells listeners about every step, and about resets, until they unsubscribe', () => {
    const loop = new FixedStepLoop(make());
    let steps = 0;
    let resets = 0;
    const off = loop.onStep(() => steps++);
    const offReset = loop.onReset(() => resets++);
    loop.fastForward(5);
    expect(steps).toBe(100);
    loop.reset();
    expect(resets).toBe(1);
    off();
    offReset();
    loop.fastForward(5);
    loop.reset();
    expect(steps).toBe(100);
    expect(resets).toBe(1);
  });
  it('shares one observation per tick with the runner', () => {
    const r = make();
    r.run(60);
    expect(r.lastObservations.length).toBe(r.engine.vehiclesOnNetwork);
    r.reset();
    expect(r.lastObservations).toHaveLength(0);
  });
});

describe('interpolation extras', () => {
  const left = NETWORK.route('N', 'left');
  const straight = NETWORK.route('N', 'straight');
  const o = (route: typeof left, s: number, speed: number): VehicleObservation => ({
    id: 1, routeIndex: route.index, approach: 'N', movement: route.movement, s, speed, distanceToStopLine: route.stopLineS - s, held: false,
  });
  const at = (prev: VehicleObservation, curr: VehicleObservation) => interpolateVehicles([prev], [curr], 1, 4.5)[0];

  it('flags braking when stopped or slowing, not when cruising or accelerating', () => {
    expect(at(o(straight, 50, 10), o(straight, 50.5, 10)).braking).toBe(false);
    expect(at(o(straight, 50, 10), o(straight, 50.5, 10.2)).braking).toBe(false);
    expect(at(o(straight, 50, 10), o(straight, 50.5, 9.9)).braking).toBe(true);
    expect(at(o(straight, 80, 0), o(straight, 80, 0)).braking).toBe(true);
  });
  it('flashes the indicator only for turns, from 35 m before the stop line until the box is left', () => {
    expect(at(o(left, 40, 10), o(left, 40.5, 10)).indicator).toBe(null);
    expect(at(o(left, left.stopLineS - 20, 10), o(left, left.stopLineS - 19.5, 10)).indicator).toBe('left');
    expect(at(o(left, left.boxExitS + 5, 10), o(left, left.boxExitS + 5.5, 10)).indicator).toBe(null);
    const right = NETWORK.route('N', 'right');
    expect(at(o(right, right.stopLineS - 5, 8), o(right, right.stopLineS - 4.5, 8)).indicator).toBe('right');
    expect(at(o(straight, straight.stopLineS - 20, 10), o(straight, straight.stopLineS - 19.5, 10)).indicator).toBe(null);
  });
  it('grows vehicles in at the entry and shrinks them away at the exit', () => {
    expect(at(o(straight, 0, 10), o(straight, 0.5, 10)).fade).toBeLessThan(0.05);
    expect(at(o(straight, 6, 10), o(straight, 6.5, 10)).fade).toBeGreaterThan(0.2);
    expect(at(o(straight, 6, 10), o(straight, 6.5, 10)).fade).toBeLessThan(0.8);
    expect(at(o(straight, 100, 10), o(straight, 100.5, 10)).fade).toBe(1);
    expect(at(o(straight, straight.length - 3, 10), o(straight, straight.length - 2.5, 10)).fade).toBeLessThan(0.5);
  });
});

describe('interpolation', () => {
  const route = NETWORK.route('N', 'straight');
  const ob = (id: number, s: number, routeIndex = route.index): VehicleObservation => ({
    id, routeIndex, approach: 'N', movement: 'straight', s, speed: 5, distanceToStopLine: route.stopLineS - s, held: false,
  });
  it('blends between the previous and current step', () => {
    const prev = [ob(1, 10)];
    const curr = [ob(1, 11)];
    const at = (a: number) => interpolateVehicles(prev, curr, a, 4.5)[0];
    expect(at(0).y).toBeCloseTo(poseAt(route, 10 - 2.25).y, 9);
    expect(at(1).y).toBeCloseTo(poseAt(route, 11 - 2.25).y, 9);
    expect(at(0.5).y).toBeCloseTo(poseAt(route, 10.5 - 2.25).y, 9);
  });
  it('draws new vehicles at their current position and ignores vehicles that left', () => {
    const out = interpolateVehicles([ob(1, 50), ob(2, 60)], [ob(2, 61), ob(3, 5)], 0.3, 4.5);
    expect(out.map((v) => v.id)).toEqual([2, 3]);
    expect(out[1].y).toBeCloseTo(poseAt(route, 5 - 2.25).y, 9);
  });
  it('clamps alpha', () => {
    const a = interpolateVehicles([ob(1, 10)], [ob(1, 11)], 7, 4.5)[0];
    const b = interpolateVehicles([ob(1, 10)], [ob(1, 11)], 1, 4.5)[0];
    expect(a.y).toBe(b.y);
  });
});
