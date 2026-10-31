import type { ControllerSpec } from './controllers';
import { METRICS, aggregate, metricByKey, pairedComparison, verdict, type ExperimentResults } from './experiment';
import type { DemandProfile } from './profiles';
import type { Summary } from './stats';

const fmt = (x: number, digits = 1): string => (Number.isFinite(x) ? x.toFixed(digits) : 'n/a');
const meanSd = (s: Summary, digits = 1): string => (s.n > 1 ? `${fmt(s.mean, digits)} ± ${fmt(s.sd, digits)}` : fmt(s.mean, digits));
const signed = (x: number, digits = 1): string => (x > 0 ? '+' : '') + fmt(x, digits);

export interface ReportOptions {
  title?: string;
  profiles: readonly DemandProfile[];
  controllers: readonly ControllerSpec[];
  /** The controller being judged. Default 'adaptive'. */
  candidateId?: string;
  /** Baselines it is judged against. Default: every fixed-time controller present. */
  referenceIds?: readonly string[];
}

const TABLE_KEYS = ['clearedPerHour', 'meanWait', 'p95Wait', 'maxWait', 'maxQueue', 'avgQueue', 'unserved'] as const;
const PAIRED_KEYS = ['meanWait', 'clearedPerHour', 'maxWait'] as const;

/** Markdown report: per-profile result tables (mean ± sd over seeds) and paired comparisons with a mechanical verdict. */
export function formatMarkdown(results: ExperimentResults, options: ReportOptions): string {
  const candidateId = options.candidateId ?? 'adaptive';
  const label = (id: string) => options.controllers.find((c) => c.id === id)?.label ?? id;
  const references = (options.referenceIds ?? options.controllers.filter((c) => c.kind.startsWith('fixed')).map((c) => c.id)).filter((id) => results.controllers.includes(id));
  const cells = aggregate(results);
  const out: string[] = [];

  out.push(`# ${options.title ?? 'Experiment results'}`, '');
  out.push(
    `${results.seeds.length} seeds (${results.seeds[0]}..${results.seeds[results.seeds.length - 1]}), ${results.duration} s simulated per run, arrivals mode. ` +
      'For each profile and seed every controller ran on the identical arrival schedule. Values are mean ± standard deviation over seeds. ' +
      'There is no drain period: vehicles still queued or waiting to enter at the end are counted as unserved and their waiting so far is included in the wait metrics. ' +
      'Detector queue counts stop at what the 80 m detector zone can hold (about 13 vehicles), so in overloaded profiles the max queue is the same for every controller and says nothing about them; the mean queue and the waits do.',
    '',
  );

  for (const profile of options.profiles.filter((p) => results.profiles.includes(p.id))) {
    out.push(`## ${profile.label}`, '', profile.description, '');
    out.push(`| Controller | ${TABLE_KEYS.map((k) => `${metricByKey(k).label} (${metricByKey(k).unit})`).join(' | ')} |`);
    out.push(`|---|${TABLE_KEYS.map(() => '---:').join('|')}|`);
    for (const cell of cells.filter((c) => c.profileId === profile.id)) {
      out.push(`| ${label(cell.controllerId)} | ${TABLE_KEYS.map((k) => meanSd(cell.metrics[k], k === 'avgQueue' ? 2 : k === 'maxQueue' || k === 'unserved' ? 1 : 1)).join(' | ')} |`);
    }
    out.push('');

    if (results.controllers.includes(candidateId) && references.length > 0) {
      out.push(`**${label(candidateId)} compared with each baseline** (paired by seed; difference = ${label(candidateId)} minus baseline; ± is the 95 % confidence half-width of the mean difference)`, '');
      out.push('| Baseline | Metric | Difference | Seeds better / tied / worse | Verdict |');
      out.push('|---|---|---:|---:|---|');
      for (const ref of references) {
        for (const key of PAIRED_KEYS) {
          const m = metricByKey(key);
          const c = pairedComparison(results, profile.id, ref, candidateId, m);
          const d = c.difference;
          const diff = d.ci95 === null ? signed(d.mean) : `${signed(d.mean)} ± ${fmt(d.ci95)}`;
          out.push(`| ${label(ref)} | ${m.label} (${m.unit}) | ${diff} | ${c.better} / ${c.tied} / ${c.worse} | ${verdict(c, m.lowerIsBetter)} |`);
        }
      }
      out.push('');
    }
  }

  const unsafe = cells.filter((c) => c.safety.redLightEntries || c.safety.safetyClamps || c.safety.overlapPairSteps);
  out.push('## Safety counters', '');
  if (unsafe.length === 0) out.push('Red-light entries, anti-overlap guard hits and overlapping vehicle pairs were all 0 in every run.', '');
  else {
    out.push('Some runs reported non-zero safety counters (worst case over seeds):', '');
    out.push('| Profile | Controller | Red entries | Guard hits | Overlap pair-steps |', '|---|---|---:|---:|---:|');
    for (const c of unsafe) out.push(`| ${c.profileId} | ${label(c.controllerId)} | ${c.safety.redLightEntries} | ${c.safety.safetyClamps} | ${c.safety.overlapPairSteps} |`);
    out.push('');
  }

  // The watchdog is the signal machine's own safeguard, not a failure: informational only.
  const watchdog = results.controllers
    .map((id) => ({ id, runs: results.runs.filter((r) => r.controllerId === id && r.safety.watchdogSwitches > 0).length }))
    .filter((w) => w.runs > 0);
  if (watchdog.length > 0) {
    out.push(
      '**Max-green watchdog (informational).** The signal machine ends any green that reaches its maximum length, whatever the controller asked for. ' +
        'It fired in: ' + watchdog.map((w) => `${label(w.id)} (${w.runs} of ${results.runs.length / results.controllers.length} runs)`).join(', ') + '. ' +
        'The adaptive controller deliberately keeps a green while no other road has meaningful demand, so the watchdog ends that rest at the limit.',
      '',
    );
  }
  return out.join('\n');
}

/**
 * Sensitivity of the adaptive controller: each variant against the default adaptive settings, paired by seed.
 * The defaults were fixed before these runs and are not changed because of them; the table shows how much the
 * outcome depends on each setting.
 */
export function formatSensitivity(results: ExperimentResults, options: { profiles: readonly DemandProfile[]; controllers: readonly ControllerSpec[]; defaultId?: string }): string {
  const defaultId = options.defaultId ?? 'adaptive';
  const label = (id: string) => options.controllers.find((c) => c.id === id)?.label ?? id;
  const cells = aggregate(results);
  const wait = metricByKey('meanWait');
  const out: string[] = [
    '# Adaptive controller: parameter sensitivity',
    '',
    `${results.seeds.length} seeds, ${results.duration} s per run, one parameter changed at a time from the defaults. Differences are paired by seed against the default adaptive settings ` +
      '(negative mean wait difference = the variant waits less). The defaults were chosen before these runs and are not changed because of them.',
    '',
  ];
  for (const profile of options.profiles.filter((p) => results.profiles.includes(p.id))) {
    out.push(`## ${profile.label}`, '', '| Variant | Cleared per hour (veh/h) | Mean wait (s) | Longest wait (s) | Mean wait vs default (s) | Verdict |', '|---|---:|---:|---:|---:|---|');
    for (const controllerId of results.controllers) {
      const cell = cells.find((c) => c.profileId === profile.id && c.controllerId === controllerId)!;
      let diff = 'default';
      let v = '';
      if (controllerId !== defaultId) {
        const c = pairedComparison(results, profile.id, defaultId, controllerId, wait);
        diff = c.difference.ci95 === null ? signed(c.difference.mean) : `${signed(c.difference.mean)} ± ${fmt(c.difference.ci95)}`;
        v = verdict(c, true);
      }
      out.push(`| ${label(controllerId)} | ${meanSd(cell.metrics.clearedPerHour, 0)} | ${meanSd(cell.metrics.meanWait)} | ${meanSd(cell.metrics.maxWait, 0)} | ${diff} | ${v} |`);
    }
    out.push('');
  }
  return out.join('\n');
}

/** One row per run with every metric: for spreadsheets and the dashboard export. */
export function runsToCsv(results: ExperimentResults): string {
  const head = ['profile', 'controller', 'seed', 'duration_s', 'schedule', ...METRICS.map((m) => m.key), 'generated', 'inserted', 'exited', 'on_road', 'backlog', 'red_entries', 'guard_hits', 'overlap_pair_steps', 'watchdog_switches'];
  const rows = results.runs.map((r) =>
    [
      r.profileId,
      r.controllerId,
      r.seed,
      r.duration,
      r.scheduleChecksum,
      ...METRICS.map((m) => Number(m.get(r).toFixed(4))),
      r.vehicles.generated,
      r.vehicles.inserted,
      r.vehicles.exited,
      r.vehicles.onRoad,
      r.vehicles.backlog,
      r.safety.redLightEntries,
      r.safety.safetyClamps,
      r.safety.overlapPairSteps,
      r.safety.watchdogSwitches,
    ].join(','),
  );
  return [head.join(','), ...rows].join('\n') + '\n';
}
