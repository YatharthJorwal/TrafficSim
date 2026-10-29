import { describe, expect, it } from 'vitest';
import { MAX_FLEET } from '../sim/config';
import { APPROACHES } from '../sim/types';
import { applySignalMode, makeLoop } from './simFactory';

describe('simulation factory', () => {
  it('builds a circulating fleet that spawns at the four entries and never shrinks', () => {
    const loop = makeLoop({ seed: 1, controller: 'fixed', mode: 'circulating', fleet: 16, rate: 300, cycle: 60 });
    const e = loop.runner.engine;
    expect(e.isCirculating).toBe(true);
    expect(e.fleetSize).toBe(16);
    loop.fastForward(90);
    expect(e.vehiclesOnNetwork).toBe(16);
    expect(APPROACHES.every((a) => e.stats.perApproach[a].inserted === 4)).toBe(true);
    expect(e.addVehicles(8)).toBe(8);
    loop.fastForward(60);
    expect(e.vehiclesOnNetwork).toBe(24);
    expect(e.addVehicles(1000)).toBe(MAX_FLEET - 24);
  });

  it('builds the open-boundary arrivals mode used for experiments', () => {
    const loop = makeLoop({ seed: 1, controller: 'fixed', mode: 'arrivals', fleet: 16, rate: 300, cycle: 60 });
    const e = loop.runner.engine;
    expect(e.isCirculating).toBe(false);
    loop.fastForward(120);
    expect(e.stats.generated).toBeGreaterThan(10);
    expect(e.observe().every((o) => !o.persistent)).toBe(true);
  });

  it('builds either controller and drives the junction with it', () => {
    for (const controller of ['fixed', 'adaptive'] as const) {
      const loop = makeLoop({ seed: 2, controller, mode: 'arrivals', fleet: 8, rate: 400, cycle: 60 });
      expect(loop.runner.controller.name).toBe(controller === 'fixed' ? 'fixed-time' : 'adaptive');
      loop.fastForward(300);
      expect(loop.runner.machine.log.filter((e) => e.type === 'green').length).toBeGreaterThan(3);
      expect(loop.runner.engine.stats.exited).toBeGreaterThan(20);
    }
  });

  it('applies the debug signal override and releases it', () => {
    const loop = makeLoop({ seed: 1, controller: 'fixed', mode: 'circulating', fleet: 8, rate: 300, cycle: 60 });
    applySignalMode(loop, 'red');
    expect(loop.runner.overridden).toBe(true);
    applySignalMode(loop, 'controller');
    expect(loop.runner.overridden).toBe(false);
  });
});
