import {
  BROWSER_CONTROLLERS,
  METRICS,
  PROFILES,
  controllerLabel,
  customProfile,
  metricByKey,
  pairRows,
  profileLabel,
  rowControllers,
  rowProfiles,
  rowSeeds,
  rowsFor,
  summarizeRows,
  validateSettings,
  verdict,
  type BrowserControllerId,
  type BrowserRunSettings,
  type DemandProfile,
  type PairedComparison,
  type ReproInfo,
  type RunRow,
  type Summary,
  type Verdict,
} from '../../experiments';
import { APPROACHES, type Approach, type TurnMix } from '../../sim/types';
import type { BarDatum } from '../charts/BarChart';

/** A colour always belongs to the same controller, whichever ones are showing (the palette's fixed slot order). */
export const CONTROLLER_COLOR: Record<string, string> = {
  adaptive: 'var(--series-1)',
  'fixed-60': 'var(--series-2)',
  'fixed-webster': 'var(--series-3)',
  'fixed-searched': 'var(--series-4)',
};
export const controllerColor = (id: string): string => CONTROLLER_COLOR[id] ?? 'var(--ink-2)';

/** Approaches take the same four slots in compass order. */
export const APPROACH_COLOR: Record<Approach, string> = { N: 'var(--series-1)', E: 'var(--series-2)', S: 'var(--series-3)', W: 'var(--series-4)' };

export const CARD_METRICS: readonly { key: string; digits: number }[] = [
  { key: 'meanWait', digits: 1 },
  { key: 'clearedPerHour', digits: 0 },
  { key: 'maxWait', digits: 0 },
  { key: 'unserved', digits: 0 },
];

const DIGITS: Record<string, number> = { clearedPerHour: 0, meanWait: 1, p95Wait: 1, maxWait: 0, maxQueue: 0, avgQueue: 2, unserved: 0, meanTimeStopped: 1, meanWaitExitedOnly: 1, signalSwitches: 0 };
export const metricDigits = (key: string): number => DIGITS[key] ?? 1;

export interface CardModel {
  key: string;
  label: string;
  unit: string;
  digits: number;
  lowerIsBetter: boolean;
  candidate: Summary;
  baseline: Summary;
  paired: PairedComparison;
  verdict: Verdict;
}

/** Cards comparing the candidate with one baseline on one profile. Empty when either has no runs. */
export function buildCards(rows: readonly RunRow[], profileId: string, candidateId: string, baselineId: string): CardModel[] {
  if (rowsFor(rows, profileId, candidateId).length === 0 || rowsFor(rows, profileId, baselineId).length === 0) return [];
  return CARD_METRICS.map(({ key, digits }) => {
    const m = metricByKey(key);
    const paired = pairRows(rows, profileId, baselineId, candidateId, key);
    return {
      key,
      label: m.label,
      unit: m.unit,
      digits,
      lowerIsBetter: m.lowerIsBetter,
      candidate: summarizeRows(rows, profileId, candidateId, key),
      baseline: summarizeRows(rows, profileId, baselineId, key),
      paired,
      verdict: verdict(paired, m.lowerIsBetter),
    };
  });
}

/** Bars for one profile and metric, in the order the controllers appear in the data. */
export function barData(rows: readonly RunRow[], profileId: string, metricKey: string): BarDatum[] {
  return rowControllers(rows)
    .filter((id) => rowsFor(rows, profileId, id).length > 0)
    .map((id) => {
      const rs = rowsFor(rows, profileId, id);
      const s = summarizeRows(rows, profileId, id, metricKey);
      return { id, label: controllerLabel(id), color: controllerColor(id), mean: s.mean, sd: s.sd, values: rs.map((r) => r.metrics[metricKey]), seeds: rs.map((r) => r.seed) };
    });
}

export interface SummaryRow {
  profile: string;
  controller: string;
  metric: string;
  unit: string;
  n: number;
  mean: number;
  sd: number;
  min: number;
  max: number;
  ci95: number | null;
}

/** Every profile, controller and metric as one flat table (for the JSON export). */
export function summaryRows(rows: readonly RunRow[]): SummaryRow[] {
  const out: SummaryRow[] = [];
  for (const profile of rowProfiles(rows)) {
    for (const controller of rowControllers(rows)) {
      if (rowsFor(rows, profile, controller).length === 0) continue;
      for (const m of METRICS) {
        const s = summarizeRows(rows, profile, controller, m.key);
        out.push({ profile, controller, metric: m.key, unit: m.unit, n: s.n, mean: s.mean, sd: s.sd, min: s.min, max: s.max, ci95: s.ci95 });
      }
    }
  }
  return out;
}

export interface ExportInput {
  appVersion: string;
  exportedAt: string;
  source: 'published' | 'browser';
  rows: readonly RunRow[];
  repro?: ReproInfo;
  /** How the published numbers were produced (the CLI command). */
  command?: string;
}

/** Everything needed to inspect and repeat a result in one JSON document. */
export function buildExportReport(i: ExportInput): Record<string, unknown> {
  return {
    app: { name: 'traffic-sim', version: i.appVersion },
    exportedAt: i.exportedAt,
    source: i.source,
    ...(i.command ? { command: i.command } : {}),
    seeds: rowSeeds(i.rows),
    profiles: rowProfiles(i.rows),
    controllers: rowControllers(i.rows),
    notes: [
      'All wait metrics are over every generated vehicle, including those still queued or waiting to enter at the end (no drain period).',
      'Controllers on the same profile and seed saw the identical arrival schedule (same `schedule` fingerprint).',
      'Detector queue counts stop at what the 80 m detector zone can hold, so max queue is not informative in overloaded profiles.',
    ],
    ...(i.repro ? { settings: i.repro.settings, reproducibility: i.repro } : {}),
    summary: summaryRows(i.rows),
    runs: i.rows,
  };
}

// ------------------------------------------------------------------ run form

export interface RunForm {
  /** 'custom' or the id of a ready-made profile. */
  preset: string;
  profile: DemandProfile;
  duration: number;
  seeds: number;
  controllers: BrowserControllerId[];
}

export const seriesIntervalFor = (duration: number): number => Math.max(1, Math.round(duration / 60));

export function formToSettings(f: RunForm): BrowserRunSettings {
  return { profile: f.profile, duration: f.duration, seeds: f.seeds, controllers: [...f.controllers], seriesInterval: seriesIntervalFor(f.duration) };
}

export function defaultForm(): RunForm {
  return { preset: 'uneven', profile: PROFILES.find((p) => p.id === 'uneven')!, duration: 600, seeds: 4, controllers: [...BROWSER_CONTROLLERS] };
}

export function presetForm(f: RunForm, preset: string, rates?: Record<Approach, number>): RunForm {
  if (preset === 'custom') {
    const base = rates ?? { ...f.profile.segments[0].rates };
    return { ...f, preset, profile: customProfile(base, f.profile.turnMix) };
  }
  const profile = PROFILES.find((p) => p.id === preset);
  if (!profile) throw new Error(`unknown preset "${preset}"`);
  return { ...f, preset, profile };
}

export function withRate(f: RunForm, approach: Approach, rate: number): RunForm {
  const rates = { ...f.profile.segments[0].rates, [approach]: rate };
  return { ...f, preset: 'custom', profile: customProfile(rates, f.profile.turnMix) };
}

export function withTurnMix(f: RunForm, mix: TurnMix): RunForm {
  return { ...f, preset: 'custom', profile: customProfile(f.profile.segments[0].rates, mix) };
}

/** Which preset a profile equals, or 'custom' for a one-segment profile, or 'imported' for anything else. */
export function presetOf(profile: DemandProfile): string {
  const same = PROFILES.find((p) => JSON.stringify([p.segments, p.turnMix]) === JSON.stringify([profile.segments, profile.turnMix]));
  if (same) return same.id;
  return profile.segments.length === 1 ? 'custom' : 'imported';
}

export interface ParsedSettings {
  settings?: BrowserRunSettings;
  error?: string;
}

/** Read a settings file: either the settings object itself or a full exported report that contains `settings`. */
export function settingsFromJson(text: string): ParsedSettings {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: 'That file is not valid JSON.' };
  }
  const obj = data as { settings?: unknown; profile?: unknown };
  const candidate = (obj && typeof obj === 'object' && 'settings' in obj ? obj.settings : data) as BrowserRunSettings | undefined;
  if (!candidate || typeof candidate !== 'object' || !candidate.profile || !Array.isArray(candidate.profile.segments) || !Array.isArray(candidate.controllers)) {
    return { error: 'That file does not contain run settings (expected profile, duration, seeds and controllers).' };
  }
  const settings: BrowserRunSettings = {
    profile: candidate.profile,
    duration: Number(candidate.duration),
    seeds: Number(candidate.seeds),
    controllers: candidate.controllers,
    seriesInterval: Number(candidate.seriesInterval ?? seriesIntervalFor(Number(candidate.duration))),
  };
  const issues = validateSettings(settings);
  return issues.length ? { error: `Those settings cannot be run: ${issues.join('; ')}` } : { settings };
}

export function formFromSettings(s: BrowserRunSettings): RunForm {
  return { preset: presetOf(s.profile), profile: s.profile, duration: s.duration, seeds: s.seeds, controllers: [...s.controllers] };
}

/** One-line description of a profile for headings: "Uneven" or "Custom demand: N 450, E 100 ...". */
export function describeProfile(profile: DemandProfile): string {
  return profile.id === 'custom' ? profile.description : `${profileLabel(profile.id)}: ${profile.description}`;
}

export const rateRowOrder: readonly Approach[] = APPROACHES;
