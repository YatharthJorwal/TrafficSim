import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROFILES, rowsFromCsv, rowProfiles, rowControllers, strongestFixed } from '../../experiments';
import {
  barData,
  buildCards,
  buildExportReport,
  controllerColor,
  defaultForm,
  formFromSettings,
  formToSettings,
  presetForm,
  presetOf,
  seriesIntervalFor,
  settingsFromJson,
  summaryRows,
  withRate,
} from './model';

const rows = rowsFromCsv(readFileSync(new URL('../../../docs/results/runs.csv', import.meta.url), 'utf8'));

describe('dashboard model', () => {
  it('reads the published runs and finds every profile and controller', () => {
    expect(rowProfiles(rows).length).toBeGreaterThanOrEqual(5);
    expect(rowControllers(rows)).toContain('adaptive');
    expect(rowControllers(rows).some((c) => c.startsWith('fixed'))).toBe(true);
  });

  it('builds the four metric cards with a verdict backed by the paired data', () => {
    const profile = rowProfiles(rows).find((p) => p === 'shifting')!;
    const baseline = strongestFixed(rows, profile)!;
    const cards = buildCards(rows, profile, 'adaptive', baseline);
    expect(cards.map((c) => c.key)).toEqual(['meanWait', 'clearedPerHour', 'maxWait', 'unserved']);
    const wait = cards[0];
    expect(wait.lowerIsBetter).toBe(true);
    expect(wait.candidate.mean).toBeLessThan(wait.baseline.mean); // the published result: adaptive waits less on shifting demand
    expect(wait.paired.better + wait.paired.tied + wait.paired.worse).toBe(wait.candidate.n);
  });

  it('returns no cards when a controller has no runs', () => {
    expect(buildCards(rows, rowProfiles(rows)[0], 'adaptive', 'no-such-controller')).toEqual([]);
    expect(buildCards([], 'x', 'adaptive', 'fixed-60')).toEqual([]);
  });

  it('gives each controller one bar per seed set, in a stable colour', () => {
    const profile = rowProfiles(rows)[0];
    const bars = barData(rows, profile, 'meanWait');
    expect(bars.length).toBe(rowControllers(rows).length);
    for (const b of bars) {
      expect(b.values.length).toBe(b.seeds.length);
      expect(b.color).toBe(controllerColor(b.id));
    }
    expect(controllerColor('adaptive')).not.toBe(controllerColor('fixed-60'));
    expect(controllerColor('mystery')).toBeTruthy();
  });

  it('summarises every profile, controller and metric for the JSON export', () => {
    const table = summaryRows(rows);
    expect(table.length).toBeGreaterThan(rowProfiles(rows).length * 2);
    expect(table.every((r) => r.n > 0 && Number.isFinite(r.mean))).toBe(true);
  });

  it('exports a report that holds the runs, seeds and the caveats', () => {
    const report = buildExportReport({ appVersion: 't', exportedAt: '2026-01-01T00:00:00Z', source: 'published', rows, command: 'npm run experiment' });
    expect(report.runs).toHaveLength(rows.length);
    expect(report.command).toBe('npm run experiment');
    expect(JSON.parse(JSON.stringify(report)).seeds.length).toBeGreaterThan(1);
    expect((report.notes as string[]).join(' ')).toMatch(/no drain period/);
    expect(report).not.toHaveProperty('settings');
  });
});

describe('run form', () => {
  it('starts on a valid, runnable configuration', () => {
    const s = formToSettings(defaultForm());
    expect(s.seeds).toBeGreaterThan(0);
    expect(s.controllers).toContain('adaptive');
    expect(s.seriesInterval).toBe(seriesIntervalFor(s.duration));
  });

  it('switches to a custom profile when a single rate is edited', () => {
    const f = withRate(defaultForm(), 'N', 777);
    expect(f.preset).toBe('custom');
    expect(f.profile.segments[0].rates.N).toBe(777);
    expect(f.profile.segments[0].rates.E).toBe(PROFILES.find((p) => p.id === 'uneven')!.segments[0].rates.E);
  });

  it('applies a preset and rejects an unknown one', () => {
    expect(presetForm(defaultForm(), 'heavy').profile.id).toBe('heavy');
    expect(() => presetForm(defaultForm(), 'nope')).toThrow(/unknown preset/);
  });

  it('recognises which preset a profile is', () => {
    for (const p of PROFILES) expect(presetOf(p)).toBe(p.id);
    expect(presetOf(withRate(defaultForm(), 'S', 123).profile)).toBe('custom');
  });

  it('round-trips settings through a downloaded file and through a full report', () => {
    const settings = formToSettings(withRate(defaultForm(), 'W', 640));
    const direct = settingsFromJson(JSON.stringify(settings));
    expect(direct.error).toBeUndefined();
    expect(direct.settings).toEqual(settings);
    const wrapped = settingsFromJson(JSON.stringify({ settings, runs: [] }));
    expect(wrapped.settings).toEqual(settings);
    expect(formToSettings(formFromSettings(settings))).toEqual(settings);
  });

  it('refuses files that are not settings, or that exceed the limits', () => {
    expect(settingsFromJson('not json').error).toMatch(/not valid JSON/);
    expect(settingsFromJson('{"a":1}').error).toMatch(/does not contain run settings/);
    const big = { ...formToSettings(defaultForm()), seeds: 500 };
    expect(settingsFromJson(JSON.stringify(big)).error).toMatch(/cannot be run/);
  });
});
