import { describe, expect, it } from 'vitest';
import { TWO_PHASE_PLAN } from '../control';
import type { Measurements } from '../detectors/types';
import type { Approach, VehicleLedgerEntry } from '../sim/types';
import { RunRecorder, computeVehicleMetrics, vehicleWait } from './metrics';
import { comparePaired, percentile, summarize, tCritical95 } from './stats';
import { verdict } from './experiment';

describe('statistics', () => {
  it('summarises a sample with a hand-computed mean, sd and confidence interval', () => {
    // 2 4 4 4 5 5 7 9: mean 5, sum of squares 32, sample variance 32/7, sd 2.1381
    const s = summarize([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(s.n).toBe(8);
    expect(s.mean).toBe(5);
    expect(s.sd).toBeCloseTo(Math.sqrt(32 / 7), 10);
    expect(s.min).toBe(2);
    expect(s.max).toBe(9);
    // t(7 df) = 2.365: half-width = 2.365 * 2.1381 / sqrt(8) = 1.7878
    expect(s.ci95).toBeCloseTo((2.365 * Math.sqrt(32 / 7)) / Math.sqrt(8), 10);
  });

  it('has no interval for a single value and no mean for an empty sample', () => {
    expect(summarize([7])).toMatchObject({ n: 1, mean: 7, sd: 0, ci95: null });
    expect(summarize([]).mean).toBeNaN();
  });

  it('looks up Student t values and falls back to 1.96 for large samples', () => {
    expect(tCritical95(1)).toBe(12.706);
    expect(tCritical95(30)).toBe(2.042);
    expect(tCritical95(500)).toBe(1.96);
    expect(tCritical95(0)).toBeNaN();
  });

  it('interpolates percentiles', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([5, 1, 4, 2, 3], 0.95)).toBeCloseTo(4.8, 10); // position 3.8 -> 4 + 0.8
    expect(percentile([9], 0.95)).toBe(9);
  });

  it('pairs seeds and counts better, tied and worse results', () => {
    const c = comparePaired([10, 10, 10], [8, 10.2, 12], true, 0.5);
    expect(c.better).toBe(1); // 8 < 10
    expect(c.tied).toBe(1); // within 0.5
    expect(c.worse).toBe(1); // 12 > 10
    expect(c.difference.mean).toBeCloseTo((-2 + 0.2 + 2) / 3, 10);
    // higher is better flips the reading
    const h = comparePaired([10, 10], [12, 8], false);
    expect([h.better, h.worse]).toEqual([1, 1]);
    expect(() => comparePaired([1], [1, 2], true)).toThrow();
  });

  it('only gives a verdict when the confidence interval excludes zero', () => {
    const mk = (mean: number, ci95: number | null) => ({ difference: { n: 8, mean, sd: 1, min: 0, max: 0, ci95 }, better: 0, tied: 0, worse: 0 });
    expect(verdict(mk(-5, 2), true)).toBe('better'); // lower wait, interval clear of zero
    expect(verdict(mk(5, 2), true)).toBe('worse');
    expect(verdict(mk(-1, 2), true)).toBe('no clear difference');
    expect(verdict(mk(5, 2), false)).toBe('better'); // higher throughput is better
    expect(verdict(mk(-9, null), true)).toBe('no clear difference'); // one seed: no interval, no verdict
  });
});

const entry = (over: Partial<VehicleLedgerEntry>): VehicleLedgerEntry => ({
  id: 1,
  approach: 'N',
  movement: 'straight',
  generatedAt: 0,
  status: 'exited',
  backlogWait: 0,
  queueWait: 0,
  stoppedTime: 0,
  ...over,
});

describe('vehicle metrics (SPEC definitions, hand-computed)', () => {
  // A exited:  2 s in the backlog + 8 s queued = 10 s wait, 9 s stopped
  // B exited:  0 + 4 = 4 s wait, 5 s stopped
  // C on road: 1 + 5 = 6 s wait so far, 6 s stopped
  // D backlog: still outside, has waited 20 s
  const ledger: VehicleLedgerEntry[] = [
    entry({ id: 1, status: 'exited', backlogWait: 2, queueWait: 8, stoppedTime: 9 }),
    entry({ id: 2, status: 'exited', backlogWait: 0, queueWait: 4, stoppedTime: 5 }),
    entry({ id: 3, status: 'onRoad', backlogWait: 1, queueWait: 5, stoppedTime: 6 }),
    entry({ id: 4, status: 'backlog', backlogWait: 20, queueWait: 0, stoppedTime: 0 }),
  ];
  const m = computeVehicleMetrics(ledger, 1800);

  it('counts generated, inserted, exited, on-road and backlog separately', () => {
    expect(m).toMatchObject({ generated: 4, inserted: 3, exited: 2, onRoad: 1, backlog: 1 });
  });

  it('cleared per hour is exited / (T / 3600)', () => {
    expect(m.clearedPerHour).toBe(4); // 2 vehicles in half an hour
  });

  it('mean wait covers ALL generated vehicles, so queues and the backlog cannot hide', () => {
    expect(vehicleWait(ledger[0])).toBe(10);
    expect(m.meanWait).toBe((10 + 4 + 6 + 20) / 4); // 10 s
    expect(m.maxWait).toBe(20);
    expect(m.p95Wait).toBeCloseTo(18.5, 10); // sorted 4 6 10 20: position 2.85 -> 10 + 0.85 * 10
  });

  it('the exited-only mean is survivor-biased and lower here', () => {
    expect(m.meanWaitExitedOnly).toBe((10 + 4) / 2); // 7 s
    expect(m.meanWaitExitedOnly).toBeLessThan(m.meanWait);
  });

  it('time stopped averages over vehicles that reached the road (backlog time excluded)', () => {
    expect(m.meanTimeStopped).toBeCloseTo((9 + 5 + 6) / 3, 10);
  });

  it('an empty ledger gives NaN means instead of a made-up zero', () => {
    const e = computeVehicleMetrics([], 600);
    expect(e.generated).toBe(0);
    expect(e.meanWait).toBeNaN();
    expect(e.clearedPerHour).toBe(0);
  });
});

function measurements(queue: Record<Approach, number>, overflow: Partial<Record<Approach, boolean>> = {}): Measurements {
  const one = (a: Approach) => ({
    observed: { inZone: 0, approaching: 0, queueLength: queue[a], queueLengthM: queue[a] * 6.5, zoneOverflow: overflow[a] ?? false, avgWait: 0, maxWait: 0, arrivals: 0, departures: 0 },
    estimated: { demandVehPerHour: 0 },
  });
  return { N: one('N'), E: one('E'), S: one('S'), W: one('W') };
}

describe('RunRecorder (queues and utilisation, hand-computed)', () => {
  const NS = { N: 'green', S: 'green', E: 'red', W: 'red' } as const;
  const EW = { N: 'red', S: 'red', E: 'green', W: 'green' } as const;
  const ALL_RED = { N: 'red', S: 'red', E: 'red', W: 'red' } as const;

  const rec = new RunRecorder(TWO_PHASE_PLAN);
  // 1 s, NS green; queues N2 S4 E1 W0; N crosses the stop line once
  rec.sample(1, NS, measurements({ N: 2, S: 4, E: 1, W: 0 }), { N: 1, S: 0, E: 0, W: 0 });
  // 1 s, EW green; queues N0 S2 E3 W1 (W past the zone end); E crosses twice, N and S cross once each while RED
  rec.sample(1, EW, measurements({ N: 0, S: 2, E: 3, W: 1 }, { W: true }), { N: 2, S: 1, E: 2, W: 0 });
  // 2 s, all red, empty queues
  rec.sample(2, ALL_RED, measurements({ N: 0, S: 0, E: 0, W: 0 }), { N: 2, S: 1, E: 2, W: 0 });
  const r = rec.result();

  it('utilisation is entries during green per green second, per phase', () => {
    expect(r.phases.NS).toEqual({ greenSeconds: 1, entriesOnGreen: 1, utilisation: 1 });
    // the N and S crossings in tick 2 happened on red, so they do not count
    expect(r.phases.EW).toEqual({ greenSeconds: 1, entriesOnGreen: 2, utilisation: 2 });
  });

  it('queue metrics are time averages over the 4 s run', () => {
    expect(r.maxQueue).toBe(4);
    expect(r.maxQueueLengthM).toBe(4 * 6.5);
    expect(r.avgQueueByApproach).toEqual({ N: 2 / 4, S: (4 + 2) / 4, E: (1 + 3) / 4, W: 1 / 4 });
    expect(r.avgQueue).toBeCloseTo((0.5 + 1.5 + 1 + 0.25) / 4, 10);
  });

  it('reports the share of the run with a queue past the detector zone', () => {
    expect(r.zoneOverflowShare).toBe(1 / 4);
  });

  it('a phase that was never green has zero utilisation, not NaN', () => {
    const idle = new RunRecorder(TWO_PHASE_PLAN);
    idle.sample(1, ALL_RED, measurements({ N: 0, S: 0, E: 0, W: 0 }), { N: 0, S: 0, E: 0, W: 0 });
    expect(idle.result().phases.NS.utilisation).toBe(0);
  });
});
