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

describe('arrivals mode with a demand profile', () => {
  const heavyNorth = { N: 900, E: 60, S: 60, W: 60 };

  it('feeds each approach at its own rate', async () => {
    const { customProfile } = await import('../experiments');
    const loop = makeLoop({ seed: 3, controller: 'fixed', mode: 'arrivals', fleet: 8, rate: 300, cycle: 60, profile: customProfile(heavyNorth) });
    loop.fastForward(600);
    const per = loop.runner.engine.stats.perApproach;
    expect(per.N.generated).toBeGreaterThan(per.E.generated * 4);
    expect(per.N.generated).toBeGreaterThan(per.S.generated * 4);
  });

  it('is the same traffic for both controllers, and for a repeated build', async () => {
    const { customProfile } = await import('../experiments');
    const profile = customProfile(heavyNorth);
    const gen = (controller: 'fixed' | 'adaptive') => {
      const loop = makeLoop({ seed: 5, controller, mode: 'arrivals', fleet: 8, rate: 300, cycle: 60, profile });
      loop.fastForward(300);
      return APPROACHES.map((a) => loop.runner.engine.stats.perApproach[a].generated);
    };
    expect(gen('fixed')).toEqual(gen('adaptive'));
    expect(gen('fixed')).toEqual(gen('fixed'));
  });

  it('changes demand part way through a shifting profile', async () => {
    const { profileById } = await import('../experiments');
    const loop = makeLoop({ seed: 4, controller: 'adaptive', mode: 'arrivals', fleet: 8, rate: 300, cycle: 60, profile: profileById('shifting') });
    loop.fastForward(900);
    const first = { ...loop.runner.engine.stats.perApproach };
    const nsFirst = first.N.generated + first.S.generated;
    const ewFirst = first.E.generated + first.W.generated;
    expect(nsFirst).not.toBe(ewFirst);
  });

  it('ignores the profile in circulating mode', async () => {
    const { customProfile } = await import('../experiments');
    const loop = makeLoop({ seed: 1, controller: 'fixed', mode: 'circulating', fleet: 8, rate: 300, cycle: 60, profile: customProfile(heavyNorth) });
    expect(loop.runner.engine.isCirculating).toBe(true);
  });
});
