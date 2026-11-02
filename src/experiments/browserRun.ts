import { AdaptiveController, DEFAULT_TIMING, FixedTimeController, cycleLengthOf, type FixedTimePlan } from '../control';
import { createConfig } from '../sim/config';
import { APPROACHES, type Approach, type TurnMix } from '../sim/types';
import { SATURATION_FLOW, adaptive, defaultFixed, tunedFixed, type ControllerSpec } from './controllers';
import { runOne, type RunResult, type SeriesPoint } from './experiment';
import { buildSchedule, scheduleChecksum, validateProfile, type DemandProfile } from './profiles';
import { controllerLabel, rowFromResult, type RunRow } from './rows';

/**
 * A short paired experiment that runs inside the browser (in a Web Worker). It is the same code path as
 * `npm run experiment`: one arrival schedule per seed shared by every controller, the same metrics and the same
 * baselines, only with a shorter horizon and fewer seeds so it finishes in seconds.
 */

export type BrowserControllerId = 'fixed-60' | 'fixed-webster' | 'adaptive';
export const BROWSER_CONTROLLERS: readonly BrowserControllerId[] = ['fixed-60', 'fixed-webster', 'adaptive'];

export const LIMITS = {
  minDuration: 120,
  maxDuration: 1800,
  maxSeeds: 12,
  maxRate: 1500,
  minSeriesInterval: 1,
} as const;

export interface BrowserRunSettings {
  profile: DemandProfile;
  /** Simulated seconds per run. */
  duration: number;
  /** Seeds 1..seeds. */
  seeds: number;
  controllers: BrowserControllerId[];
  /** Seconds between time-series samples. */
  seriesInterval: number;
}

export const DEFAULT_TURN_MIX: TurnMix = { left: 0.2, straight: 0.6, right: 0.2 };

/** A constant-demand profile from four per-approach rates. */
export function customProfile(rates: Record<Approach, number>, turnMix: TurnMix = DEFAULT_TURN_MIX): DemandProfile {
  const total = APPROACHES.reduce((n, a) => n + rates[a], 0);
  return {
    id: 'custom',
    label: 'Custom demand',
    description: `N ${rates.N}, E ${rates.E}, S ${rates.S}, W ${rates.W} veh/h (${total} total)`,
    turnMix: { ...turnMix },
    segments: [{ startFraction: 0, rates: { ...rates } }],
  };
}

export function defaultSettings(profile: DemandProfile): BrowserRunSettings {
  return { profile, duration: 600, seeds: 4, controllers: [...BROWSER_CONTROLLERS], seriesInterval: 10 };
}

/** Everything wrong with the settings, as readable sentences. Empty when they can be run. */
export function validateSettings(s: BrowserRunSettings): string[] {
  const e = validateProfile(s.profile);
  const mix = s.profile.turnMix;
  if (![mix.left, mix.straight, mix.right].every((x) => Number.isFinite(x) && x >= 0) || mix.left + mix.straight + mix.right <= 0) e.push('turn mix must be non-negative numbers that are not all zero');
  for (const [i, seg] of s.profile.segments.entries()) {
    for (const a of APPROACHES) if (seg.rates[a] > LIMITS.maxRate) e.push(`segment ${i}: rate for ${a} is above ${LIMITS.maxRate} veh/h`);
  }
  if (!Number.isFinite(s.duration) || s.duration < LIMITS.minDuration || s.duration > LIMITS.maxDuration) e.push(`duration must be between ${LIMITS.minDuration} and ${LIMITS.maxDuration} s`);
  if (!Number.isInteger(s.seeds) || s.seeds < 1 || s.seeds > LIMITS.maxSeeds) e.push(`seeds must be a whole number from 1 to ${LIMITS.maxSeeds}`);
  if (s.controllers.length === 0) e.push('choose at least one controller');
  for (const c of s.controllers) if (!BROWSER_CONTROLLERS.includes(c)) e.push(`unknown controller "${c}"`);
  if (new Set(s.controllers).size !== s.controllers.length) e.push('a controller was listed twice');
  if (!(s.seriesInterval >= LIMITS.minSeriesInterval) || s.seriesInterval > s.duration) e.push('the time-series interval must be between 1 s and the run duration');
  return e;
}

export function controllerSpec(id: BrowserControllerId): ControllerSpec {
  return id === 'fixed-60' ? defaultFixed() : id === 'fixed-webster' ? tunedFixed() : adaptive();
}

/** One time series across seeds: mean with the lowest and highest seed at each sample. */
export interface BandPoint {
  t: number;
  mean: number;
  min: number;
  max: number;
}
export interface ControllerSeries {
  queue: BandPoint[];
  unserved: BandPoint[];
}

export function bandSeries(runs: readonly RunResult[], pick: (p: SeriesPoint) => number): BandPoint[] {
  const all = runs.map((r) => r.series ?? []);
  const n = Math.min(...all.map((s) => s.length));
  if (!Number.isFinite(n) || n === 0) return [];
  const out: BandPoint[] = [];
  for (let i = 0; i < n; i++) {
    const vals = all.map((s) => pick(s[i]));
    out.push({ t: all[0][i].t, mean: vals.reduce((a, b) => a + b, 0) / vals.length, min: Math.min(...vals), max: Math.max(...vals) });
  }
  return out;
}

export interface ControllerInfo {
  id: string;
  label: string;
  /** Plain-language description of the settings used. */
  description: string;
  plan?: FixedTimePlan;
  cycle?: number;
  adaptiveConfig?: Record<string, number>;
}

/** What someone needs to repeat the run: the settings, the seeds, each schedule's fingerprint, and the controller settings. */
export interface ReproInfo {
  settings: BrowserRunSettings;
  seeds: number[];
  scheduleChecksums: Record<number, string>;
  controllers: ControllerInfo[];
  engine: { dt: number; speedVariation: number; vehicle: Record<string, number>; signalTiming: Record<string, number>; saturationFlow: number };
}

function describeController(spec: ControllerSpec, profile: DemandProfile): ControllerInfo {
  const c = spec.make(profile);
  if (c instanceof FixedTimeController) {
    const cycle = cycleLengthOf(c.plan, DEFAULT_TIMING);
    const greens = c.plan.order.map((id) => `${id} ${c.plan.greens[id]} s`).join(' / ');
    return { id: spec.id, label: controllerLabel(spec.id), description: `green ${greens}, cycle ${cycle.toFixed(0)} s`, plan: c.plan, cycle };
  }
  if (c instanceof AdaptiveController) {
    return { id: spec.id, label: controllerLabel(spec.id), description: 'rule-based, observed detector values only', adaptiveConfig: { ...c.config } };
  }
  return { id: spec.id, label: controllerLabel(spec.id), description: c.name };
}

export interface BrowserRunOutput {
  settings: BrowserRunSettings;
  rows: RunRow[];
  series: Record<string, ControllerSeries>;
  info: ReproInfo;
}

export interface BrowserRunHooks {
  onProgress?: (done: number, total: number) => void;
  /** Checked between runs; when it returns true the run stops and `null` is returned. */
  cancelled?: () => boolean;
}

/** Run the experiment. Throws one error listing every problem when the settings are invalid. */
export function runBrowserExperiment(settings: BrowserRunSettings, hooks: BrowserRunHooks = {}): BrowserRunOutput | null {
  const issues = validateSettings(settings);
  if (issues.length) throw new Error(`Invalid settings:\n - ${issues.join('\n - ')}`);
  const specs = settings.controllers.map(controllerSpec);
  const seeds = Array.from({ length: settings.seeds }, (_, i) => i + 1);
  const total = seeds.length * specs.length;
  const results: RunResult[] = [];
  const checksums: Record<number, string> = {};
  for (const seed of seeds) {
    const schedule = buildSchedule(settings.profile, seed, settings.duration);
    checksums[seed] = scheduleChecksum(schedule);
    for (const controller of specs) {
      if (hooks.cancelled?.()) return null;
      results.push(runOne({ profile: settings.profile, controller, seed, duration: settings.duration, schedule, seriesInterval: settings.seriesInterval }));
      hooks.onProgress?.(results.length, total);
    }
  }
  const series: Record<string, ControllerSeries> = {};
  for (const spec of specs) {
    const runs = results.filter((r) => r.controllerId === spec.id);
    series[spec.id] = { queue: bandSeries(runs, (p) => p.queue), unserved: bandSeries(runs, (p) => p.unserved) };
  }
  const config = createConfig({ duration: settings.duration });
  return {
    settings,
    rows: results.map(rowFromResult),
    series,
    info: {
      settings,
      seeds,
      scheduleChecksums: checksums,
      controllers: specs.map((s) => describeController(s, settings.profile)),
      engine: {
        dt: config.dt,
        speedVariation: config.speedVariation,
        vehicle: { ...config.vehicle },
        signalTiming: { ...DEFAULT_TIMING },
        saturationFlow: SATURATION_FLOW,
      },
    },
  };
}
