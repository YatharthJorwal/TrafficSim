/**
 * Quick fixed-time vs adaptive comparison on identical arrival schedules (arrivals mode).
 * PREVIEW ONLY: the proper experiment framework, metric definitions and statistics arrive in milestone 5.
 * Usage: npm run sim:compare -- [seconds] [seeds]
 */
import { AdaptiveController, DEFAULT_TIMING, FixedTimeController, TWO_PHASE_PLAN, planFromCycle, type SignalController } from '../src/control';
import { createConfig } from '../src/sim/config';
import { generateSchedule } from '../src/sim/schedule';
import { APPROACHES, type Approach } from '../src/sim/types';
import { SimulationRunner } from '../src/runtime';

const seconds = Number(process.argv[2] ?? 1800);
const seeds = Number(process.argv[3] ?? 4);

type Profile = { name: string; rate: Record<Approach, number> };
const rates = (ns: number, ew: number): Record<Approach, number> => ({ N: ns, S: ns, E: ew, W: ew });
const profiles: Profile[] = [
  { name: 'light', rate: rates(120, 120) },
  { name: 'balanced', rate: rates(250, 250) },
  { name: 'uneven', rate: rates(450, 100) },
  { name: 'heavy', rate: rates(400, 400) },
];

interface Result { cleared: number; unserved: number; meanWait: number; maxQueue: number; maxWait: number }

function run(profile: Profile, seed: number, make: () => SignalController): Result {
  const config = createConfig({ seed, duration: seconds });
  for (const a of APPROACHES) config.demand[a] = { ratePerHour: profile.rate[a], turnMix: { left: 0.2, straight: 0.6, right: 0.2 } };
  const runner = new SimulationRunner(config, make(), { schedule: generateSchedule(config) });
  runner.run(seconds);
  const e = runner.engine;
  const done = e.completed;
  const queue = Math.max(...APPROACHES.map((a) => runner.detectors.totals(a).peakQueueCount));
  const wait = Math.max(...APPROACHES.map((a) => runner.detectors.totals(a).peakWait));
  return {
    cleared: (e.stats.exited / seconds) * 3600,
    unserved: e.stats.generated - e.stats.exited,
    meanWait: done.reduce((n, r) => n + r.waitingTime, 0) / Math.max(1, done.length),
    maxQueue: queue,
    maxWait: wait,
  };
}

const fixed = () => new FixedTimeController(TWO_PHASE_PLAN, DEFAULT_TIMING, planFromCycle(TWO_PHASE_PLAN, DEFAULT_TIMING, 60));
const adaptive = () => new AdaptiveController(TWO_PHASE_PLAN, DEFAULT_TIMING);
/** A fixed plan whose green split matches the demand ratio of the profile: the fair baseline for uneven demand. */
const tunedFixed = (p: Profile) => () =>
  new FixedTimeController(TWO_PHASE_PLAN, DEFAULT_TIMING, planFromCycle(TWO_PHASE_PLAN, DEFAULT_TIMING, 60, { NS: p.rate.N + p.rate.S, EW: p.rate.E + p.rate.W }));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

console.log(`fixed-time (60 s cycle) vs adaptive, ${seconds}s, ${seeds} seeds, identical schedules. Means over seeds.`);
console.log('profile    controller   cleared/h  unserved  mean wait (exited)  max queue  worst wait');
for (const p of profiles) {
  const tuned = p.rate.N !== p.rate.E ? ([['fixed-tuned', tunedFixed(p)]] as const) : [];
  for (const [name, make] of [['fixed', fixed], ...tuned, ['adaptive', adaptive]] as const) {
    const rs = Array.from({ length: seeds }, (_, i) => run(p, i + 1, make));
    const f = (k: keyof Result, d = 0) => mean(rs.map((r) => r[k])).toFixed(d);
    console.log(`${p.name.padEnd(10)} ${name.padEnd(11)} ${f('cleared').padStart(9)} ${f('unserved').padStart(9)} ${f('meanWait', 1).padStart(18)} ${f('maxQueue', 1).padStart(10)} ${f('maxWait', 0).padStart(11)}`);
  }
}
