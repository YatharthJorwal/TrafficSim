/**
 * Headless engine run (milestone 1). Prints counts and basic delay statistics.
 * Usage: npm run sim:headless -- [seed] [vehiclesPerHourPerApproach] [seconds] [cycle|green]
 * The signal source is a placeholder two-phase cycle until the control layer lands (milestone 2).
 */
import { createConfig, uniformDemand } from '../src/sim/config';
import { ALL_GREEN, simpleCycle } from '../src/sim/debugSignals';
import { SimulationEngine } from '../src/sim/engine';
import { APPROACHES } from '../src/sim/types';

const seed = Number(process.argv[2] ?? 1);
const rate = Number(process.argv[3] ?? 500);
const seconds = Number(process.argv[4] ?? 1800);
const mode = process.argv[5] ?? 'cycle';

const config = createConfig({ seed, duration: seconds });
config.demand = uniformDemand(rate);

const engine = new SimulationEngine(config, { diagnostics: true });
const t0 = performance.now();
while (engine.time < seconds) {
  engine.setSignals(mode === 'green' ? ALL_GREEN : simpleCycle(engine.time));
  engine.step();
}
const wall = performance.now() - t0;

const s = engine.stats;
const done = engine.completed;
const meanWait = done.reduce((n, r) => n + r.waitingTime, 0) / Math.max(1, done.length);
console.log(`seed=${seed} demand=${rate}/h/approach duration=${seconds}s signals=${mode}`);
console.log(`generated=${s.generated} inserted=${s.inserted} entered=${s.enteredIntersection} exited=${s.exited} onNetwork=${engine.vehiclesOnNetwork}`);
console.log(`backlog=${APPROACHES.map((a) => `${a}:${engine.backlogCount(a)}`).join(' ')}`);
console.log(`mean waiting time (exited vehicles) = ${meanWait.toFixed(2)} s`);
console.log(`safety: redEntries=${s.redLightEntries} clamps=${s.safetyClamps} overlaps=${s.overlapPairSteps} minGap=${s.minGap.toFixed(2)} m`);
console.log(`limits: maxSpeed=${s.maxSpeed.toFixed(2)} maxAccel=${s.maxAccel.toFixed(2)} maxDecel=${s.maxDecel.toFixed(2)}`);
console.log(`performance: ${engine.steps} steps in ${wall.toFixed(0)} ms (${((seconds / wall) * 1000).toFixed(0)}x real time)`);
