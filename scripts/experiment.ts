/**
 * Experiment runner: paired fixed-time vs adaptive runs on identical arrival schedules.
 *
 *   npm run experiment -- [options]
 *     --duration <s>        simulated seconds per run (default 1800)
 *     --seeds <n>           seeds 1..n (default 8)
 *     --profiles <a,b,..>   subset of: light, balanced, uneven, heavy, shifting (default all)
 *     --sensitivity         also sweep the adaptive parameters one at a time (--sens-seeds <n>, default 4)
 *     --sensitivity-only    run only that sweep and write it as the report
 *     --diagnostics         per-step body-overlap checks (slower)
 *     --md <file>           write the Markdown report
 *     --json <file>         write every run as JSON
 *     --csv <file>          write one CSV row per run
 *     --calibrate           measure the saturation flow used by the Webster baseline and exit
 */
import { writeFileSync } from 'node:fs';
import {
  PROFILES,
  SATURATION_FLOW,
  adaptive,
  defaultFixed,
  formatMarkdown,
  formatSensitivity,
  profileById,
  runExperiment,
  runsToCsv,
  sensitivityVariants,
  standardControllers,
  type ControllerSpec,
  type ExperimentResults,
} from '../src/experiments';

function parseArgs(argv: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error(`unexpected argument "${argv[i]}"`);
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out.set(key, 'true');
    else {
      out.set(key, next);
      i++;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const duration = Number(args.get('duration') ?? 1800);
const seedCount = Number(args.get('seeds') ?? 8);
if (!(duration > 0) || !(seedCount >= 1)) throw new Error('--duration must be positive and --seeds at least 1');
const seeds = Array.from({ length: seedCount }, (_, i) => i + 1);

const progress = (label: string) => (done: number, total: number) => {
  if (done % 10 === 0 || done === total) process.stderr.write(`\r${label} ${done}/${total} runs`);
};

if (args.has('calibrate')) {
  // Saturation flow under real signal operation: heavy demand, default plan. Utilisation is entries per green second.
  const results = runExperiment({ profiles: [profileById('heavy')], controllers: [defaultFixed()], seeds, duration });
  const per: number[] = [];
  for (const r of results.runs) {
    for (const ph of Object.values(r.queues.phases)) per.push((ph.utilisation / 2) * 3600);
  }
  const mean = per.reduce((a, b) => a + b, 0) / per.length;
  console.log(`measured saturation flow per approach: ${mean.toFixed(0)} veh per hour of green (min ${Math.min(...per).toFixed(0)}, max ${Math.max(...per).toFixed(0)}, ${per.length} samples)`);
  console.log(`value currently used by the Webster baseline: ${SATURATION_FLOW}`);
  process.exit(0);
}

const profiles = (args.get('profiles')?.split(',') ?? PROFILES.map((p) => p.id)).map(profileById);
const sensitivityOnly = args.has('sensitivity-only');

let results: ExperimentResults | null = null;
const parts: string[] = [];

if (!sensitivityOnly) {
  const controllers: ControllerSpec[] = standardControllers(duration);
  const started = Date.now();
  results = runExperiment({ profiles, controllers, seeds, duration, diagnostics: args.has('diagnostics'), onRun: progress('experiment') });
  process.stderr.write(`\rfinished ${results.runs.length} runs in ${((Date.now() - started) / 1000).toFixed(0)} s\n`);
  parts.push(
    formatMarkdown(results, {
      title: `Fixed-time vs adaptive: ${profiles.length} profiles, ${seeds.length} seeds, ${duration} s`,
      profiles,
      controllers,
      referenceIds: controllers.filter((c) => c.kind.startsWith('fixed')).map((c) => c.id),
    }),
  );
}

if (args.has('sensitivity') || sensitivityOnly) {
  const sensSeeds = Array.from({ length: Number(args.get('sens-seeds') ?? 4) }, (_, i) => i + 1);
  const sensControllers = [adaptive(), ...sensitivityVariants()];
  const sens = runExperiment({ profiles, controllers: sensControllers, seeds: sensSeeds, duration, onRun: progress('sensitivity') });
  process.stderr.write('\n');
  parts.push(formatSensitivity(sens, { profiles, controllers: sensControllers }));
  if (sensitivityOnly) results = sens;
}

const report = parts.join('\n\n');
const md = args.get('md');
if (md) writeFileSync(md, report + '\n');
const json = args.get('json');
if (json && results) writeFileSync(json, JSON.stringify(results));
const csv = args.get('csv');
if (csv && results) writeFileSync(csv, runsToCsv(results));
if (!md) console.log(report);
else console.log(`wrote ${md}`);
