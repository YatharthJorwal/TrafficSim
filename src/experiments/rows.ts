import { METRICS, metricByKey, type RunResult } from './experiment';
import { PROFILES } from './profiles';
import { comparePaired, summarize, type PairedComparison, type Summary } from './stats';

/**
 * A flat, serialisable record of one run: what the CSV holds, what the dashboard reads, and what the published
 * results are stored as. In-browser runs and the published `docs/results/runs.csv` both become `RunRow`s, so the
 * same charts and cards work on either.
 */
export interface RunRow {
  profileId: string;
  controllerId: string;
  seed: number;
  /** Simulated seconds in the run. */
  duration: number;
  /** Fingerprint of the arrival schedule: equal for every controller on the same profile and seed. */
  schedule: string;
  /** One value per entry of `METRICS` (by key). */
  metrics: Record<string, number>;
  counts: { generated: number; inserted: number; exited: number; onRoad: number; backlog: number };
  safety: { redLightEntries: number; safetyClamps: number; overlapPairSteps: number; watchdogSwitches: number };
}

export const CONTROLLER_LABELS: Record<string, string> = {
  'fixed-60': 'Fixed 60 s, equal split',
  'fixed-webster': 'Fixed, Webster-tuned',
  'fixed-searched': 'Fixed, best searched plan',
  adaptive: 'Adaptive (rule-based)',
};

export const controllerLabel = (id: string): string => CONTROLLER_LABELS[id] ?? id;

export function profileLabel(id: string): string {
  return PROFILES.find((p) => p.id === id)?.label ?? (id === 'custom' ? 'Custom demand' : id);
}

export function rowFromResult(r: RunResult): RunRow {
  const metrics: Record<string, number> = {};
  for (const m of METRICS) metrics[m.key] = m.get(r);
  const v = r.vehicles;
  return {
    profileId: r.profileId,
    controllerId: r.controllerId,
    seed: r.seed,
    duration: r.duration,
    schedule: r.scheduleChecksum,
    metrics,
    counts: { generated: v.generated, inserted: v.inserted, exited: v.exited, onRoad: v.onRoad, backlog: v.backlog },
    safety: { ...r.safety },
  };
}

const COUNT_COLUMNS = ['generated', 'inserted', 'exited', 'on_road', 'backlog'] as const;
const SAFETY_COLUMNS = ['red_entries', 'guard_hits', 'overlap_pair_steps', 'watchdog_switches'] as const;
const HEAD = ['profile', 'controller', 'seed', 'duration_s', 'schedule', ...METRICS.map((m) => m.key), ...COUNT_COLUMNS, ...SAFETY_COLUMNS];

export function rowsToCsv(rows: readonly RunRow[]): string {
  const lines = rows.map((r) =>
    [
      r.profileId,
      r.controllerId,
      r.seed,
      r.duration,
      r.schedule,
      ...METRICS.map((m) => Number(r.metrics[m.key].toFixed(4))),
      r.counts.generated,
      r.counts.inserted,
      r.counts.exited,
      r.counts.onRoad,
      r.counts.backlog,
      r.safety.redLightEntries,
      r.safety.safetyClamps,
      r.safety.overlapPairSteps,
      r.safety.watchdogSwitches,
    ].join(','),
  );
  return [HEAD.join(','), ...lines].join('\n') + '\n';
}

/** Parse the CSV written by `rowsToCsv`. Throws a readable error for a wrong header or a malformed value. */
export function rowsFromCsv(text: string): RunRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new Error('the CSV is empty');
  const head = lines[0].split(',');
  const col = new Map(head.map((h, i) => [h.trim(), i]));
  for (const h of HEAD) if (!col.has(h)) throw new Error(`the CSV has no "${h}" column`);
  const rows: RunRow[] = [];
  lines.slice(1).forEach((line, n) => {
    const cells = line.split(',');
    if (cells.length !== head.length) throw new Error(`row ${n + 2} has ${cells.length} values, expected ${head.length}`);
    const text = (name: string) => cells[col.get(name)!].trim();
    const num = (name: string) => {
      const v = Number(text(name));
      if (!Number.isFinite(v) && text(name) !== 'NaN') throw new Error(`row ${n + 2}: "${name}" is not a number`);
      return v;
    };
    const metrics: Record<string, number> = {};
    for (const m of METRICS) metrics[m.key] = num(m.key);
    rows.push({
      profileId: text('profile'),
      controllerId: text('controller'),
      seed: num('seed'),
      duration: num('duration_s'),
      schedule: text('schedule'),
      metrics,
      counts: { generated: num('generated'), inserted: num('inserted'), exited: num('exited'), onRoad: num('on_road'), backlog: num('backlog') },
      safety: { redLightEntries: num('red_entries'), safetyClamps: num('guard_hits'), overlapPairSteps: num('overlap_pair_steps'), watchdogSwitches: num('watchdog_switches') },
    });
  });
  return rows;
}

const unique = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

/** Profile ids in order of first appearance. */
export const rowProfiles = (rows: readonly RunRow[]): string[] => unique(rows.map((r) => r.profileId));
/** Controller ids in order of first appearance. */
export const rowControllers = (rows: readonly RunRow[]): string[] => unique(rows.map((r) => r.controllerId));
export const rowSeeds = (rows: readonly RunRow[]): number[] => unique(rows.map((r) => r.seed)).sort((a, b) => a - b);

/** Runs of one profile and controller, ordered by seed. */
export function rowsFor(rows: readonly RunRow[], profileId: string, controllerId: string): RunRow[] {
  return rows.filter((r) => r.profileId === profileId && r.controllerId === controllerId).sort((a, b) => a.seed - b.seed);
}

export function summarizeRows(rows: readonly RunRow[], profileId: string, controllerId: string, metricKey: string): Summary {
  return summarize(rowsFor(rows, profileId, controllerId).map((r) => r.metrics[metricKey]));
}

/**
 * Pair two controllers seed by seed on one profile and metric. Refuses to compare runs that did not share an arrival
 * schedule, or that do not cover the same seeds.
 */
export function pairRows(rows: readonly RunRow[], profileId: string, referenceId: string, candidateId: string, metricKey: string): PairedComparison {
  const ref = rowsFor(rows, profileId, referenceId);
  const cand = rowsFor(rows, profileId, candidateId);
  if (ref.length === 0 || cand.length === 0) throw new Error(`no runs to pair for ${profileId}: ${referenceId} vs ${candidateId}`);
  if (ref.length !== cand.length || ref.some((r, i) => r.seed !== cand[i].seed)) throw new Error(`${profileId}: ${referenceId} and ${candidateId} do not cover the same seeds`);
  ref.forEach((r, i) => {
    if (r.schedule !== cand[i].schedule) throw new Error(`${profileId} seed ${r.seed}: the two controllers did not see the same schedule`);
  });
  const m = metricByKey(metricKey);
  return comparePaired(
    ref.map((r) => r.metrics[metricKey]),
    cand.map((r) => r.metrics[metricKey]),
    m.lowerIsBetter,
    m.tieTolerance,
  );
}

/**
 * The strongest fixed-time baseline for a profile: the fixed controller with the lowest mean wait (all generated
 * vehicles). Null when no fixed-time controller ran.
 */
export function strongestFixed(rows: readonly RunRow[], profileId: string): string | null {
  let best: { id: string; wait: number } | null = null;
  for (const id of rowControllers(rows).filter((c) => c.startsWith('fixed'))) {
    const rs = rowsFor(rows, profileId, id);
    if (rs.length === 0) continue;
    const wait = summarizeRows(rows, profileId, id, 'meanWait').mean;
    if (best === null || wait < best.wait) best = { id, wait };
  }
  return best?.id ?? null;
}
