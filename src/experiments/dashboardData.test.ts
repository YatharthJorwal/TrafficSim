import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BROWSER_CONTROLLERS,
  LIMITS,
  bandSeries,
  controllerLabel,
  customProfile,
  defaultFixed,
  defaultSettings,
  pairRows,
  profileById,
  profileLabel,
  rowControllers,
  rowFromResult,
  rowProfiles,
  rowSeeds,
  rowsFor,
  rowsFromCsv,
  rowsToCsv,
  runBrowserExperiment,
  runOne,
  runsToCsv,
  strongestFixed,
  summarizeRows,
  validateSettings,
  type BrowserRunSettings,
  type RunRow,
} from './index';

const row = (over: Partial<RunRow> & { wait?: number; cleared?: number }): RunRow => ({
  profileId: 'p',
  controllerId: 'fixed-60',
  seed: 1,
  duration: 600,
  schedule: '10:abc',
  metrics: { clearedPerHour: over.cleared ?? 100, meanWait: over.wait ?? 10, p95Wait: 0, maxWait: 0, maxQueue: 0, avgQueue: 0, unserved: 0, meanTimeStopped: 0, meanWaitExitedOnly: 0, signalSwitches: 0 },
  counts: { generated: 1, inserted: 1, exited: 1, onRoad: 0, backlog: 0 },
  safety: { redLightEntries: 0, safetyClamps: 0, overlapPairSteps: 0, watchdogSwitches: 0 },
  ...over,
});

describe('run rows and CSV', () => {
  it('round-trips through CSV (values are kept to 4 decimals)', () => {
    const r = runOne({ profile: profileById('light'), controller: defaultFixed(), seed: 2, duration: 200 });
    const parsed = rowsFromCsv(rowsToCsv([rowFromResult(r)]));
    expect(parsed).toHaveLength(1);
    const orig = rowFromResult(r);
    expect(parsed[0]).toMatchObject({ profileId: 'light', controllerId: 'fixed-60', seed: 2, duration: 200, schedule: orig.schedule, counts: orig.counts, safety: orig.safety });
    for (const [k, v] of Object.entries(orig.metrics)) expect(parsed[0].metrics[k]).toBeCloseTo(v, 3);
  });

  it('is the same format the experiment CLI writes (runsToCsv delegates to it)', () => {
    const r = runOne({ profile: profileById('light'), controller: defaultFixed(), seed: 1, duration: 150 });
    expect(runsToCsv({ duration: 150, seeds: [1], profiles: ['light'], controllers: ['fixed-60'], runs: [r] })).toBe(rowsToCsv([rowFromResult(r)]));
  });

  it('reads the published results shipped in docs/results/runs.csv', () => {
    const rows = rowsFromCsv(readFileSync('docs/results/runs.csv', 'utf8'));
    expect(rows).toHaveLength(160);
    expect(rowProfiles(rows)).toEqual(['light', 'balanced', 'uneven', 'heavy', 'shifting']);
    expect(rowControllers(rows)).toEqual(['fixed-60', 'fixed-webster', 'fixed-searched', 'adaptive']);
    expect(rowSeeds(rows)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const r of rows) expect(r.counts.generated).toBe(r.counts.exited + r.counts.onRoad + r.counts.backlog);
    // the number printed in docs/RESULTS.md for Shifting / Adaptive (mean wait 57.2 s)
    expect(summarizeRows(rows, 'shifting', 'adaptive', 'meanWait').mean).toBeCloseTo(57.2, 1);
  });

  it('rejects a CSV with a missing column, a short row, or a bad number', () => {
    const good = rowsToCsv([row({})]);
    expect(() => rowsFromCsv('')).toThrow(/empty/);
    expect(() => rowsFromCsv(good.replace('meanWait', 'meanwait'))).toThrow(/no "meanWait" column/);
    expect(() => rowsFromCsv(good.trimEnd() + ',9\n')).toThrow(/expected/);
    expect(() => rowsFromCsv(good.replace(',600,', ',six hundred,'))).toThrow(/not a number/);
  });

  it('labels controllers and profiles, falling back to the id', () => {
    expect(controllerLabel('adaptive')).toBe('Adaptive (rule-based)');
    expect(controllerLabel('mystery')).toBe('mystery');
    expect(profileLabel('shifting')).toBe('Shifting');
    expect(profileLabel('custom')).toBe('Custom demand');
  });
});

describe('summaries and pairing on rows', () => {
  const rows = [
    row({ controllerId: 'fixed-60', seed: 1, wait: 30 }),
    row({ controllerId: 'fixed-60', seed: 2, wait: 50 }),
    row({ controllerId: 'fixed-webster', seed: 1, wait: 20 }),
    row({ controllerId: 'fixed-webster', seed: 2, wait: 22 }),
    row({ controllerId: 'adaptive', seed: 1, wait: 12 }),
    row({ controllerId: 'adaptive', seed: 2, wait: 16 }),
  ];

  it('summarises one controller over its seeds (hand-computed)', () => {
    const s = summarizeRows(rows, 'p', 'fixed-60', 'meanWait');
    expect(s.mean).toBe(40);
    expect(s.sd).toBeCloseTo(Math.sqrt(200), 10); // deviations -10 and +10, n-1 = 1
    expect(rowsFor(rows, 'p', 'adaptive').map((r) => r.seed)).toEqual([1, 2]);
  });

  it('picks the fixed controller with the lowest mean wait as the strongest baseline, and never adaptive', () => {
    expect(strongestFixed(rows, 'p')).toBe('fixed-webster');
    expect(strongestFixed(rows.filter((r) => r.controllerId === 'adaptive'), 'p')).toBeNull();
  });

  it('pairs seed by seed: adaptive minus the baseline, lower wait is better', () => {
    const c = pairRows(rows, 'p', 'fixed-webster', 'adaptive', 'meanWait');
    expect(c.difference.mean).toBe(-7); // (12 - 20) and (16 - 22) -> -8, -6
    expect([c.better, c.tied, c.worse]).toEqual([2, 0, 0]);
  });

  it('refuses to pair runs with different schedules, different seeds, or no runs', () => {
    const tampered = rows.map((r) => (r.controllerId === 'adaptive' && r.seed === 2 ? { ...r, schedule: 'other' } : r));
    expect(() => pairRows(tampered, 'p', 'fixed-webster', 'adaptive', 'meanWait')).toThrow(/same schedule/);
    expect(() => pairRows(rows.filter((r) => !(r.controllerId === 'adaptive' && r.seed === 2)), 'p', 'fixed-webster', 'adaptive', 'meanWait')).toThrow(/same seeds/);
    expect(() => pairRows(rows, 'p', 'fixed-webster', 'nothing', 'meanWait')).toThrow(/no runs/);
  });
});

describe('browser run settings', () => {
  const settings = (over: Partial<BrowserRunSettings> = {}): BrowserRunSettings => ({ ...defaultSettings(customProfile({ N: 200, E: 200, S: 200, W: 200 })), duration: 150, seeds: 2, seriesInterval: 10, ...over });

  it('builds a one-segment custom profile with a readable description', () => {
    const p = customProfile({ N: 450, E: 100, S: 450, W: 100 });
    expect(p.id).toBe('custom');
    expect(p.segments).toEqual([{ startFraction: 0, rates: { N: 450, E: 100, S: 450, W: 100 } }]);
    expect(p.description).toContain('1100 total');
  });

  it('accepts sensible settings and lists every problem otherwise', () => {
    expect(validateSettings(settings())).toEqual([]);
    const bad = validateSettings(
      settings({
        profile: customProfile({ N: -5, E: 99999, S: 1, W: 1 }, { left: 0, straight: 0, right: 0 }),
        duration: 10,
        seeds: 0,
        controllers: [],
        seriesInterval: 0,
      }),
    );
    const text = bad.join(' | ');
    expect(text).toMatch(/rate for N/);
    expect(text).toMatch(/above 1500/);
    expect(text).toMatch(/turn mix/);
    expect(text).toMatch(/duration must be between/);
    expect(text).toMatch(/seeds must be/);
    expect(text).toMatch(/at least one controller/);
    expect(text).toMatch(/interval/);
    expect(validateSettings(settings({ duration: LIMITS.maxDuration + 1 })).join()).toMatch(/duration/);
    expect(validateSettings(settings({ controllers: ['adaptive', 'adaptive'] })).join()).toMatch(/twice/);
    expect(validateSettings(settings({ controllers: ['magic' as never] })).join()).toMatch(/unknown controller/);
  });

  it('refuses to run invalid settings', () => {
    expect(() => runBrowserExperiment(settings({ seeds: 0 }))).toThrow(/Invalid settings/);
  });
});

describe('browser experiment run', () => {
  const settings: BrowserRunSettings = { ...defaultSettings(customProfile({ N: 400, E: 150, S: 400, W: 150 })), duration: 200, seeds: 2, seriesInterval: 20 };
  const out = runBrowserExperiment(settings)!;

  it('runs every controller on every seed and reports progress', () => {
    const seen: number[] = [];
    runBrowserExperiment({ ...settings, seeds: 1 }, { onProgress: (done, total) => seen.push(done / total) });
    expect(seen).toEqual([1 / 3, 2 / 3, 1]);
    expect(out.rows).toHaveLength(2 * BROWSER_CONTROLLERS.length);
    expect(rowControllers(out.rows)).toEqual(['fixed-60', 'fixed-webster', 'adaptive']);
  });

  it('gives every controller the identical arrival schedule on a seed, and records it', () => {
    for (const seed of [1, 2]) {
      const checks = out.rows.filter((r) => r.seed === seed).map((r) => r.schedule);
      expect(new Set(checks).size).toBe(1);
      expect(out.info.scheduleChecksums[seed]).toBe(checks[0]);
    }
    expect(out.info.scheduleChecksums[1]).not.toBe(out.info.scheduleChecksums[2]);
  });

  it('is deterministic: the same settings give identical rows and series', () => {
    const again = runBrowserExperiment(settings)!;
    expect(JSON.stringify(again.rows)).toBe(JSON.stringify(out.rows));
    expect(JSON.stringify(again.series)).toBe(JSON.stringify(out.series));
  });

  it('does not use the debug override and stays safe', () => {
    for (const r of out.rows) expect([r.safety.redLightEntries, r.safety.safetyClamps, r.safety.overlapPairSteps]).toEqual([0, 0, 0]);
  });

  it('records a time series every interval with a mean and a seed range', () => {
    const q = out.series.adaptive.queue;
    expect(q).toHaveLength(10); // 200 s / 20 s
    expect(q.map((p) => p.t)).toEqual([20, 40, 60, 80, 100, 120, 140, 160, 180, 200]);
    for (const p of q) {
      expect(p.min).toBeLessThanOrEqual(p.mean);
      expect(p.mean).toBeLessThanOrEqual(p.max);
    }
    const u = out.series['fixed-60'].unserved;
    expect(u[u.length - 1].mean).toBeGreaterThan(0);
  });

  it('describes each controller so the run can be repeated', () => {
    const [fixed60, webster, adaptive] = out.info.controllers;
    expect(fixed60.plan?.greens).toEqual({ NS: 25, EW: 25 });
    expect(fixed60.cycle).toBe(60);
    expect(webster.plan!.greens.NS).toBeGreaterThan(webster.plan!.greens.EW); // 400 vs 150 veh/h
    expect(adaptive.adaptiveConfig?.minGreen).toBe(12);
    expect(out.info.engine.dt).toBe(0.05);
    expect(out.info.engine.saturationFlow).toBe(640);
  });

  it('stops and returns null when cancelled, after the runs already done', () => {
    let calls = 0;
    const r = runBrowserExperiment(settings, { cancelled: () => ++calls > 2 });
    expect(r).toBeNull();
  });

  it('bandSeries returns nothing when runs carry no series', () => {
    const r = runOne({ profile: profileById('light'), controller: defaultFixed(), seed: 1, duration: 100 });
    expect(r.series).toBeUndefined();
    expect(bandSeries([r], (p) => p.queue)).toEqual([]);
  });
});
