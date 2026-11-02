import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMING, FixedTimeController, TWO_PHASE_PLAN, planFromCycle } from '../control';
import { createConfig, uniformDemand } from '../sim/config';
import { FixedStepLoop } from './loop';
import { HistoryRecorder } from './history';
import { SimulationRunner } from './runner';

function makeLoop(seed = 1) {
  const config = createConfig({ seed, duration: 600 });
  config.demand = uniformDemand(450);
  const controller = new FixedTimeController(TWO_PHASE_PLAN, DEFAULT_TIMING, planFromCycle(TWO_PHASE_PLAN, DEFAULT_TIMING, 60));
  return new FixedStepLoop(new SimulationRunner(config, controller));
}

describe('HistoryRecorder', () => {
  it('takes one sample per simulated second, independent of how time is advanced', () => {
    const a = makeLoop();
    const b = makeLoop();
    const ha = new HistoryRecorder(a);
    const hb = new HistoryRecorder(b);
    a.fastForward(60);
    for (let i = 0; i < 600; i++) b.advance(0.1); // 60 s in 0.1 s frames
    expect(ha.samples).toHaveLength(60);
    expect(hb.samples).toHaveLength(60);
    expect(ha.samples.map((s) => s.t)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
    expect(JSON.stringify(ha.samples)).toBe(JSON.stringify(hb.samples));
  });

  it('records the detector queues and the signal phase as the machine reports them', () => {
    const loop = makeLoop();
    const h = new HistoryRecorder(loop);
    loop.fastForward(120);
    const last = h.samples[h.samples.length - 1];
    expect(last.t).toBe(120);
    expect(last.queue).toEqual(Object.fromEntries((['N', 'E', 'S', 'W'] as const).map((a) => [a, loop.runner.detectors.measurements[a].observed.queueLength])));
    expect(last.phase).toBe(loop.runner.machine.status.phase);
    expect(new Set(h.samples.map((s) => s.phase))).toEqual(new Set(['NS', 'EW']));
    expect(h.samples.some((s) => s.stage === 'yellow')).toBe(true);
  });

  it('keeps only the most recent samples', () => {
    const loop = makeLoop();
    const h = new HistoryRecorder(loop, { capacity: 30 });
    loop.fastForward(100);
    expect(h.samples).toHaveLength(30);
    expect(h.samples[0].t).toBe(71);
    expect(h.samples[29].t).toBe(100);
  });

  it('clears on reset and starts over', () => {
    const loop = makeLoop();
    const h = new HistoryRecorder(loop);
    loop.fastForward(20);
    loop.reset();
    expect(h.samples).toHaveLength(0);
    loop.fastForward(5);
    expect(h.samples.map((s) => s.t)).toEqual([1, 2, 3, 4, 5]);
  });

  it('never changes the simulation, and stops listening once disposed', () => {
    const watched = makeLoop();
    const plain = makeLoop();
    const h = new HistoryRecorder(watched);
    watched.fastForward(200);
    plain.fastForward(200);
    expect(watched.runner.engine.stateKey()).toBe(plain.runner.engine.stateKey());
    h.dispose();
    watched.fastForward(10);
    expect(h.samples[h.samples.length - 1].t).toBe(200);
  });

  it('rejects impossible options', () => {
    expect(() => new HistoryRecorder(makeLoop(), { interval: 0 })).toThrow();
    expect(() => new HistoryRecorder(makeLoop(), { capacity: 1 })).toThrow();
  });
});
