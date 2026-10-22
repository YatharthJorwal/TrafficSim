import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMING, FixedTimeController, TWO_PHASE_PLAN, planFromCycle, type SignalController } from '../control';
import { createConfig, uniformDemand } from '../sim/config';
import { generateSchedule } from '../sim/schedule';
import { APPROACHES } from '../sim/types';
import { SimulationRunner } from './runner';

const fixed = (cycle: number) => new FixedTimeController(TWO_PHASE_PLAN, DEFAULT_TIMING, planFromCycle(TWO_PHASE_PLAN, DEFAULT_TIMING, cycle));

const busy = createConfig({ seed: 21, duration: 900 });
busy.demand = uniformDemand(400, { left: 0.25, straight: 0.5, right: 0.25 });

describe('runner with the fixed-time controller', () => {
  it('runs a busy hour-fraction without overlaps, guard hits or red entries', () => {
    const r = new SimulationRunner(busy, fixed(60), { diagnostics: true });
    r.run(900);
    const s = r.engine.stats;
    expect(s.overlapPairSteps, JSON.stringify(s.firstOverlap)).toBe(0);
    expect(s.safetyClamps).toBe(0);
    expect(s.redLightEntries).toBe(0);
    expect(s.exited).toBeGreaterThan(150);
    expect(r.machine.stats.watchdogSwitches).toBe(0);
  });

  it('is deterministic: same config and plan give identical engine state and signal log', () => {
    const a = new SimulationRunner(busy, fixed(60));
    const b = new SimulationRunner(busy, fixed(60));
    a.run(400);
    b.run(400);
    expect(a.engine.stateKey()).toBe(b.engine.stateKey());
    expect(JSON.stringify(a.machine.log)).toBe(JSON.stringify(b.machine.log));
  });

  it('applies exactly the machine colours to the engine on every tick', () => {
    const r = new SimulationRunner(busy, fixed(40));
    for (let k = 0; k < 3000; k++) {
      const before = r.machine.colors;
      r.tick();
      expect(r.engine.signals).toEqual(before);
    }
  });

  it('gives different controllers an identical arrival schedule (fair comparison)', () => {
    const a = new SimulationRunner(busy, fixed(60));
    const b = new SimulationRunner(busy, fixed(90));
    expect(a.engine.schedule).toEqual(b.engine.schedule);
    expect(a.engine.schedule).toEqual(generateSchedule(busy));
    const shared = generateSchedule(busy);
    const c = new SimulationRunner(busy, fixed(60), { schedule: shared });
    const d = new SimulationRunner(busy, fixed(90), { schedule: shared });
    c.run(300);
    d.run(300);
    expect(c.engine.stats.generated).toBe(d.engine.stats.generated);
    expect(c.engine.stateKey()).not.toBe(d.engine.stateKey());
  });

  it('reset restores the start state and reproduces the same run', () => {
    const r = new SimulationRunner(busy, fixed(60));
    const fresh = new SimulationRunner(busy, fixed(60));
    r.run(250);
    const first = r.engine.stateKey();
    r.reset();
    expect(r.time).toBe(0);
    expect(r.engine.stateKey()).toBe(fresh.engine.stateKey());
    expect(r.machine.status).toMatchObject({ stage: 'green', phase: 'NS', elapsed: 0 });
    r.run(250);
    expect(r.engine.stateKey()).toBe(first);
  });

  it('debug override bypasses the controller, is flagged, and can be released', () => {
    const r = new SimulationRunner(busy, fixed(60));
    r.setDebugOverride({ N: 'red', E: 'red', S: 'red', W: 'red' });
    r.run(30);
    expect(r.snapshot().overridden).toBe(true);
    expect(r.engine.signals.N).toBe('red');
    expect(r.machine.status.elapsed).toBe(0);
    r.setDebugOverride(null);
    r.run(40);
    expect(r.snapshot().overridden).toBe(false);
    expect(r.machine.status.elapsed).toBeGreaterThan(0);
  });

  it('a misbehaving controller cannot cause conflicting signals in the running system', () => {
    let n = 0;
    const flip: SignalController = {
      name: 'flip-flop',
      reset() { n = 0; },
      decide: () => ({ phase: ++n % 2 ? 'EW' : 'NS' }),
    };
    const r = new SimulationRunner(busy, flip, { diagnostics: true });
    for (let k = 0; k < 12000; k++) {
      r.tick();
      const c = r.engine.signals;
      for (const a of APPROACHES) for (const b of APPROACHES) {
        if ((a === 'N' || a === 'S') && (b === 'E' || b === 'W')) expect(c[a] === 'red' || c[b] === 'red').toBe(true);
      }
    }
    expect(r.engine.stats.overlapPairSteps).toBe(0);
    expect(r.engine.stats.redLightEntries).toBe(0);
  });
});
