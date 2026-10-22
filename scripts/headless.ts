/**
 * Headless run: engine + signal state machine + fixed-time controller.
 * Usage: npm run sim:headless -- [seed] [vehiclesPerHourPerApproach] [seconds] [cycleSeconds]
 */
import { DEFAULT_TIMING, FixedTimeController, TWO_PHASE_PLAN, cycleLengthOf, planFromCycle } from '../src/control';
import { createConfig, uniformDemand } from '../src/sim/config';
import { APPROACHES } from '../src/sim/types';
import { SimulationRunner } from '../src/runtime';

const seed = Number(process.argv[2] ?? 1);
const rate = Number(process.argv[3] ?? 300);
const seconds = Number(process.argv[4] ?? 1800);
const cycle = Number(process.argv[5] ?? 60);

const config = createConfig({ seed, duration: seconds });
config.demand = uniformDemand(rate);
const plan = planFromCycle(TWO_PHASE_PLAN, DEFAULT_TIMING, cycle);
const runner = new SimulationRunner(config, new FixedTimeController(TWO_PHASE_PLAN, DEFAULT_TIMING, plan), { diagnostics: true });

const t0 = performance.now();
runner.run(seconds);
const wall = performance.now() - t0;

const e = runner.engine;
const s = e.stats;
const done = e.completed;
const meanWait = done.reduce((n, r) => n + r.waitingTime, 0) / Math.max(1, done.length);
console.log(`seed=${seed} demand=${rate}/h/approach duration=${seconds}s controller=${runner.controller.name}`);
console.log(`plan: green ${JSON.stringify(plan.greens)} yellow=${DEFAULT_TIMING.yellow} allRed=${DEFAULT_TIMING.allRed} cycle=${cycleLengthOf(plan, DEFAULT_TIMING)}s`);
console.log(`generated=${s.generated} inserted=${s.inserted} entered=${s.enteredIntersection} exited=${s.exited} onNetwork=${e.vehiclesOnNetwork}`);
console.log(`backlog=${APPROACHES.map((a) => `${a}:${e.backlogCount(a)}`).join(' ')}`);
console.log(`mean waiting time (exited vehicles) = ${meanWait.toFixed(2)} s`);
console.log(`signals: phase switches=${runner.machine.log.filter((x) => x.type === 'green').length - 1} rejectedRequests=${runner.machine.stats.rejectedRequests} watchdog=${runner.machine.stats.watchdogSwitches}`);
console.log(`safety: redEntries=${s.redLightEntries} clamps=${s.safetyClamps} overlaps=${s.overlapPairSteps} minGap=${s.minGap.toFixed(2)} m`);
console.log(`performance: ${e.steps} steps in ${wall.toFixed(0)} ms (${((seconds / wall) * 1000).toFixed(0)}x real time)`);
