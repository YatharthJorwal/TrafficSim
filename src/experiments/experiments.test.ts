import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMING, TWO_PHASE_PLAN, validateFixedTimePlan } from '../control';
import { ControlConfigError } from '../control/types';
import { createConfig } from '../sim/config';
import { generateSchedule } from '../sim/schedule';
import { APPROACHES, type Approach } from '../sim/types';
import { SimulationRunner } from '../runtime';
import {
  PROFILES,
  SATURATION_FLOW,
  adaptive,
  aggregate,
  averageRates,
  TUNING_SEEDS,
  buildSchedule,
  candidatePlans,
  computeVehicleMetrics,
  criticalFlowByPhase,
  defaultFixed,
  formatMarkdown,
  formatSensitivity,
  pairedComparison,
  metricByKey,
  profileById,
  runExperiment,
  runOne,
  runsToCsv,
  scheduleChecksum,
  searchedFixed,
  sensitivityVariants,
  standardControllers,
  tuneFixedPlan,
  tunedFixed,
  validateProfile,
  websterPlan,
  type DemandProfile,
  type ExperimentResults,
} from './index';

const countBy = (schedule: readonly { time: number; approach: Approach }[], approach: Approach, from: number, to: number) =>
  schedule.filter((a) => a.approach === approach && a.time >= from && a.time < to).length;

describe('demand profiles', () => {
  it('ships the five profiles and every one is valid', () => {
    expect(PROFILES.map((p) => p.id)).toEqual(['light', 'balanced', 'uneven', 'heavy', 'shifting']);
    for (const p of PROFILES) expect(validateProfile(p), p.id).toEqual([]);
    expect(() => profileById('nope')).toThrow(/unknown demand profile/);
  });

  it('computes time-weighted mean rates and the critical flow per phase (hand-computed)', () => {
    const shifting = profileById('shifting');
    // N: 450 for half the run, 100 for the other half -> 275; E: 100 then 450 -> 275
    expect(averageRates(shifting)).toEqual({ N: 275, S: 275, E: 275, W: 275 });
    expect(criticalFlowByPhase(profileById('uneven'), TWO_PHASE_PLAN)).toEqual({ NS: 450, EW: 100 });
  });

  it('rejects malformed profiles', () => {
    const bad: DemandProfile = { ...profileById('light'), segments: [{ startFraction: 0.2, rates: { N: -1, E: 1, S: 1, W: 1 } }] };
    const issues = validateProfile(bad);
    expect(issues.join(' ')).toMatch(/first segment must start at 0/);
    expect(issues.join(' ')).toMatch(/rate for N/);
    expect(() => buildSchedule(bad, 1, 600)).toThrow(/invalid demand profile/);
  });
});

describe('arrival schedules for profiles', () => {
  it('a constant profile reproduces generateSchedule of the equivalent config exactly', () => {
    const p = profileById('uneven');
    const config = createConfig({ seed: 5, duration: 900 });
    for (const a of APPROACHES) config.demand[a] = { ratePerHour: averageRates(p)[a], turnMix: { ...p.turnMix } };
    expect(buildSchedule(p, 5, 900)).toEqual(generateSchedule(config));
  });

  it('is a pure function of (profile, seed, duration): sorted, numbered 1..n, inside the horizon', () => {
    const a = buildSchedule(profileById('shifting'), 3, 1200);
    const b = buildSchedule(profileById('shifting'), 3, 1200);
    expect(a).toEqual(b);
    expect(scheduleChecksum(a)).toBe(scheduleChecksum(b));
    expect(scheduleChecksum(a)).not.toBe(scheduleChecksum(buildSchedule(profileById('shifting'), 4, 1200)));
    a.forEach((x, i) => {
      expect(x.id).toBe(i + 1);
      expect(x.time).toBeGreaterThanOrEqual(0);
      expect(x.time).toBeLessThan(1200);
      if (i > 0) expect(x.time).toBeGreaterThanOrEqual(a[i - 1].time);
    });
  });

  it('the shifting profile really changes the dominant road at the half-way point', () => {
    const s = buildSchedule(profileById('shifting'), 1, 3600);
    // expected: N 450 veh/h * 0.5 h = 225 then 50; E 50 then 225 (Poisson, sd about 15 and 7)
    expect(countBy(s, 'N', 0, 1800)).toBeGreaterThan(150);
    expect(countBy(s, 'N', 1800, 3600)).toBeLessThan(100);
    expect(countBy(s, 'E', 0, 1800)).toBeLessThan(100);
    expect(countBy(s, 'E', 1800, 3600)).toBeGreaterThan(150);
  });
});

describe('Webster-tuned fixed plan', () => {
  const T = DEFAULT_TIMING; // yellow 3 + all-red 2 per phase, two phases: lost time 10 s

  it('uneven demand: the long green is held to maxGreen and the others shrink in proportion (the cycle gets shorter)', () => {
    // y = 450/600 = 0.75 and 100/600 = 0.1667, Y = 0.9167, uncapped cycle (15 + 5) / 0.0833 = 240 s, capped to 120 s.
    // 110 s of green would split 90 / 20; NS may not exceed 60, so both scale by 60/90: NS 60 and EW 13.3
    // (NOT 60 / 50, which would give the busy road only half the cycle and starve it).
    const r = websterPlan(TWO_PHASE_PLAN, T, { NS: 450, EW: 100 }, 600);
    expect(r.flowRatio).toBeCloseTo(0.9167, 3);
    expect(r.uncappedCycle).toBeCloseTo(240, 0);
    expect(r.plan.greens).toEqual({ NS: 60, EW: 13.3 });
    expect(r.cycle).toBeCloseTo(83.3, 5);
    // the busy road keeps the green share its demand asks for: 60 / 73.3 = 82 % against 450 / 550 = 82 % of the flow
    expect(r.plan.greens.NS / (r.plan.greens.NS + r.plan.greens.EW)).toBeCloseTo(450 / 550, 1);
  });

  it('a road with no demand at all still gets the minimum green', () => {
    const r = websterPlan(TWO_PHASE_PLAN, T, { NS: 900, EW: 0 }, 600);
    expect(r.plan.greens).toEqual({ NS: 60, EW: 12 });
  });

  it('light demand: the shortest cycle the timing rules allow (two 12 s greens)', () => {
    // y = 0.2 each, Y = 0.4, uncapped 20 / 0.6 = 33.3 s, below the 34 s minimum (10 s lost + 2 x 12 s)
    const r = websterPlan(TWO_PHASE_PLAN, T, { NS: 120, EW: 120 }, 600);
    expect(r.plan.greens).toEqual({ NS: 12, EW: 12 });
    expect(r.cycle).toBe(34);
  });

  it('moderate demand: Webster gives its own optimum and a split in proportion to y', () => {
    // flows 300 / 100: y = 0.5 and 0.1667, Y = 0.6667, cycle 20 / 0.3333 = 60 s, 50 s of green split 3:1
    const r = websterPlan(TWO_PHASE_PLAN, T, { NS: 300, EW: 100 }, 600);
    expect(r.cycle).toBeCloseTo(60, 0);
    expect(r.plan.greens.NS).toBe(37.5);
    expect(r.plan.greens.EW).toBe(12.5);
  });

  it('over capacity (Y >= 1): the cycle is capped, never infinite', () => {
    const r = websterPlan(TWO_PHASE_PLAN, T, { NS: 400, EW: 400 }, 600);
    expect(r.uncappedCycle).toBe(Infinity);
    expect(r.cycle).toBe(120);
    expect(r.plan.greens).toEqual({ NS: 55, EW: 55 });
  });

  it('always yields a plan the signal rules accept, for any demand', () => {
    for (const ns of [0, 50, 200, 450, 900]) {
      for (const ew of [0, 50, 200, 450, 900]) {
        const r = websterPlan(TWO_PHASE_PLAN, T, { NS: ns, EW: ew });
        expect(validateFixedTimePlan(TWO_PHASE_PLAN, T, r.plan), `${ns}/${ew}`).toEqual([]);
      }
    }
  });

  it('rejects a non-positive saturation flow', () => {
    expect(() => websterPlan(TWO_PHASE_PLAN, T, { NS: 1, EW: 1 }, 0)).toThrow(ControlConfigError);
  });

  it('the shifting profile is tuned to its time-averaged demand, which is an even split', () => {
    const c = tunedFixed().make(profileById('shifting')) as unknown as { plan: { greens: Record<string, number> } };
    expect(c.plan.greens.NS).toBe(c.plan.greens.EW);
  });
});

describe('one run', () => {
  const profile = profileById('balanced');
  const run = (seed: number) => runOne({ profile, controller: defaultFixed(), seed, duration: 300 });

  it('is deterministic: same inputs give identical results', () => {
    expect(JSON.stringify(run(2))).toBe(JSON.stringify(run(2)));
    expect(run(2).scheduleChecksum).not.toBe(run(3).scheduleChecksum);
  });

  it('accounts for every vehicle: generated = exited + on road + backlog, inserted = exited + on road', () => {
    const v = run(1).vehicles;
    expect(v.generated).toBeGreaterThan(40);
    expect(v.generated).toBe(v.exited + v.onRoad + v.backlog);
    expect(v.inserted).toBe(v.exited + v.onRoad);
    expect(v.clearedPerHour).toBeCloseTo((v.exited / 300) * 3600, 9);
  });

  it('agrees with the engine counters of an identical hand-driven runner', () => {
    const r = run(1);
    const config = createConfig({ seed: 1, duration: 300 });
    for (const a of APPROACHES) config.demand[a] = { ratePerHour: 250, turnMix: { ...profile.turnMix } };
    const runner = new SimulationRunner(config, defaultFixed().make(profile), { schedule: buildSchedule(profile, 1, 300) });
    runner.run(300);
    expect(r.vehicles.generated).toBe(runner.engine.stats.generated);
    expect(r.vehicles.exited).toBe(runner.engine.stats.exited);
    expect(r.queues.maxQueue).toBe(Math.max(...APPROACHES.map((a) => runner.detectors.totals(a).peakQueueCount)));
  });

  it('records signal switching and green time that matches the plan', () => {
    const r = run(1);
    // 60 s cycle with 25 s greens: in 300 s there are about 10 switches, and each phase is green about 5 * 25 s
    expect(r.signalSwitches).toBeGreaterThanOrEqual(9);
    expect(r.signalSwitches).toBeLessThanOrEqual(11);
    expect(r.queues.phases.NS.greenSeconds).toBeGreaterThan(100);
    expect(r.queues.phases.NS.greenSeconds).toBeLessThan(150);
  });
});

describe('paired experiment', () => {
  const profiles = [profileById('light'), profileById('uneven'), profileById('shifting')];
  // the grid-searched baseline is covered by its own tests below (searching inside every test would be slow)
  const controllers = [defaultFixed(), tunedFixed(), adaptive()];
  const results = runExperiment({ profiles, controllers, seeds: [1, 2, 3], duration: 400, diagnostics: true });

  it('runs every combination in a fixed order', () => {
    expect(results.runs.length).toBe(3 * 3 * 3);
    expect(results.runs[0]).toMatchObject({ profileId: 'light', seed: 1, controllerId: 'fixed-60' });
    expect(results.runs[2]).toMatchObject({ profileId: 'light', seed: 1, controllerId: 'adaptive' });
  });

  it('gives every controller the identical arrival schedule for a profile and seed (X1)', () => {
    for (const p of profiles) {
      for (const seed of results.seeds) {
        const rs = results.runs.filter((r) => r.profileId === p.id && r.seed === seed);
        expect(new Set(rs.map((r) => r.scheduleChecksum)).size).toBe(1);
        expect(new Set(rs.map((r) => r.vehicles.generated)).size).toBe(1);
      }
    }
  });

  it('is safe under every controller: no red entries, overlaps or guard hits', () => {
    for (const r of results.runs) {
      const { redLightEntries, safetyClamps, overlapPairSteps } = r.safety;
      expect({ redLightEntries, safetyClamps, overlapPairSteps }, `${r.profileId}/${r.controllerId}/${r.seed}`).toEqual({ redLightEntries: 0, safetyClamps: 0, overlapPairSteps: 0 });
    }
  });

  it('fixed-time plans never reach the watchdog (their greens end by plan); adaptive may rest in green until it does', () => {
    for (const r of results.runs.filter((x) => x.controllerId !== 'adaptive')) expect(r.safety.watchdogSwitches).toBe(0);
  });

  it('aggregates per profile and controller', () => {
    const cells = aggregate(results);
    expect(cells.length).toBe(9);
    const cell = cells.find((c) => c.profileId === 'uneven' && c.controllerId === 'adaptive')!;
    expect(cell.n).toBe(3);
    const vals = results.runs.filter((r) => r.profileId === 'uneven' && r.controllerId === 'adaptive').map((r) => r.vehicles.meanWait);
    expect(cell.metrics.meanWait.mean).toBeCloseTo(vals.reduce((a, b) => a + b, 0) / 3, 9);
  });

  it('pairs two controllers seed by seed and refuses runs that did not share a schedule', () => {
    const m = metricByKey('meanWait');
    const c = pairedComparison(results, 'uneven', 'fixed-60', 'adaptive', m);
    expect(c.better + c.tied + c.worse).toBe(3);
    const tampered: ExperimentResults = {
      ...results,
      runs: results.runs.map((r) => (r.profileId === 'uneven' && r.controllerId === 'adaptive' && r.seed === 2 ? { ...r, scheduleChecksum: 'different' } : r)),
    };
    expect(() => pairedComparison(tampered, 'uneven', 'fixed-60', 'adaptive', m)).toThrow(/same schedule/);
  });

  it('writes a Markdown report and a CSV with one row per run', () => {
    const md = formatMarkdown(results, { title: 'Test', profiles, controllers });
    expect(md).toContain('# Test');
    expect(md).toContain('## Uneven');
    expect(md).toContain('Adaptive (rule-based) compared with each baseline');
    expect(md).toMatch(/no drain period/);
    expect(md).toMatch(/Safety counters/);
    expect(md).toMatch(/(were all 0 in every run|non-zero safety counters)/);
    const lines = runsToCsv(results).trim().split('\n');
    expect(lines.length).toBe(results.runs.length + 1);
    const width = lines[0].split(',').length;
    for (const l of lines) expect(l.split(',').length).toBe(width);
  });

  it('rejects empty or duplicated inputs', () => {
    expect(() => runExperiment({ profiles: [], controllers, seeds: [1], duration: 100 })).toThrow();
    expect(() => runExperiment({ profiles, controllers: [defaultFixed(), defaultFixed()], seeds: [1], duration: 100 })).toThrow(/unique/);
  });
});

describe('an unserved queue cannot hide', () => {
  it('when one road is never served, its vehicles still raise the mean wait (the survivor-only mean ignores them)', () => {
    // Unit test of the metric only: the debug override pins N/S green so E/W starve for the whole run.
    // (Experiments never use the override, and no real controller can do this: the watchdog forces the phases to alternate.)
    const profile = profileById('balanced');
    const config = createConfig({ seed: 1, duration: 600 });
    for (const a of APPROACHES) config.demand[a] = { ratePerHour: 250, turnMix: { ...profile.turnMix } };
    const runner = new SimulationRunner(config, defaultFixed().make(profile), { schedule: buildSchedule(profile, 1, 600) });
    runner.setDebugOverride({ N: 'green', S: 'green', E: 'red', W: 'red' });
    runner.run(600);
    const m = computeVehicleMetrics(runner.engine.ledger(), 600);
    const eastWest = runner.engine.ledger().filter((e) => e.approach === 'E' || e.approach === 'W');
    expect(eastWest.filter((e) => e.status === 'exited')).toHaveLength(0);
    expect(m.generated - m.exited).toBeGreaterThan(50);
    expect(m.meanWait).toBeGreaterThan(m.meanWaitExitedOnly * 2);
    expect(m.maxWait).toBeGreaterThan(400);
  });
});

describe('grid-searched fixed baseline', () => {
  it('lists the valid candidate plans (hand-computed with 10 s lost per cycle and a 12 s minimum green)', () => {
    // cycle 40: 30 s of green -> shares .4 .5 .6 give 12/18, 15/15, 18/12; .3 (9 s) and .7 (9 s) break the minimum
    // cycle 60: 50 s of green -> all five shares are valid; cycle 90: 80 s -> all five, longest green 56 s <= 60
    const plans = candidatePlans();
    expect(plans.length).toBe(3 + 5 + 5);
    expect(plans[0]).toMatchObject({ cycle: 40, share: 0.4, plan: { greens: { NS: 12, EW: 18 } } });
    expect(plans[plans.length - 1]).toMatchObject({ cycle: 90, share: 0.7, plan: { greens: { NS: 56, EW: 24 } } });
    for (const p of plans) expect(validateFixedTimePlan(TWO_PHASE_PLAN, DEFAULT_TIMING, p.plan)).toEqual([]);
  });

  it('is tuned on seeds the evaluation never uses', () => {
    for (const s of TUNING_SEEDS) expect(s).toBeGreaterThan(1000);
  });

  it('gives the busy road the longer green when demand is directional, and the search is deterministic', () => {
    const options = { duration: 300, cycles: [60], shares: [0.3, 0.7], seeds: [9001], refine: 0 };
    const a = tuneFixedPlan(profileById('uneven'), options);
    const b = tuneFixedPlan(profileById('uneven'), options);
    expect(a.best.share).toBe(0.7); // N/S carries 450 veh/h per approach against 100 on E/W
    expect(a.best.plan.greens.NS).toBeGreaterThan(a.best.plan.greens.EW);
    expect(a.candidates).toEqual(b.candidates);
    expect(a.best.meanWait).toBe(Math.min(...a.candidates.map((c) => c.meanWait)));
  }, 60_000);

  it('also considers extra plans, never evaluates a plan twice, and refinement can only improve the result', () => {
    const base = { duration: 300, cycles: [60], shares: [0.5], seeds: [9001] };
    const webster = websterPlan(TWO_PHASE_PLAN, DEFAULT_TIMING, { NS: 450, EW: 100 }).plan;
    const coarse = tuneFixedPlan(profileById('uneven'), { ...base, refine: 0, extraPlans: [webster, webster] });
    expect(coarse.candidates.length).toBe(2); // the 25/25 grid plan and the Webster plan once
    const refined = tuneFixedPlan(profileById('uneven'), { ...base, refine: 2, extraPlans: [webster] });
    expect(refined.candidates.length).toBeGreaterThan(coarse.candidates.length);
    const keys = refined.candidates.map((c) => JSON.stringify(c.plan));
    expect(new Set(keys).size).toBe(keys.length);
    expect(refined.best.meanWait).toBeLessThanOrEqual(coarse.best.meanWait);
  }, 120_000);

  it('searches once per profile and reuses the plan', () => {
    const spec = searchedFixed({ duration: 300, cycles: [60], shares: [0.3, 0.7], seeds: [9001], refine: 0 });
    const first = spec.make(profileById('uneven')) as unknown as { plan: unknown };
    const second = spec.make(profileById('uneven')) as unknown as { plan: unknown };
    expect(first.plan).toEqual(second.plan);
  }, 60_000);

  it('writes a sensitivity report with a default row and paired differences', () => {
    const variants = sensitivityVariants().slice(0, 2);
    const controllers = [adaptive(), ...variants];
    const results = runExperiment({ profiles: [profileById('light')], controllers, seeds: [1, 2], duration: 200 });
    const md = formatSensitivity(results, { profiles: [profileById('light')], controllers });
    expect(md).toContain('# Adaptive controller: parameter sensitivity');
    expect(md).toContain('| Adaptive (rule-based) |');
    expect(md).toContain('default');
    expect(md).toContain('minGreen = 16');
  }, 60_000);
});

describe('controller specs and baselines', () => {
  it('the standard set is the default fixed plan, a Webster plan, a searched plan and adaptive', () => {
    expect(standardControllers(300).map((c) => c.id)).toEqual(['fixed-60', 'fixed-webster', 'fixed-searched', 'adaptive']);
  });

  it('the sensitivity sweep varies one parameter at a time around the defaults', () => {
    const variants = sensitivityVariants();
    expect(variants.length).toBe(8);
    expect(new Set(variants.map((v) => v.id)).size).toBe(8);
    for (const v of variants) expect(v.kind).toBe('adaptive-variant');
    expect(adaptive().kind).toBe('adaptive');
  });

  it('the Webster baseline is built from demand only; the adaptive controller never sees the profile', () => {
    // two profiles with different demand must give different fixed-webster plans but the same adaptive configuration
    const a = tunedFixed().make(profileById('light')) as unknown as { plan: unknown };
    const b = tunedFixed().make(profileById('uneven')) as unknown as { plan: unknown };
    expect(a.plan).not.toEqual(b.plan);
    const x = adaptive().make(profileById('light')) as unknown as { config: unknown };
    const y = adaptive().make(profileById('uneven')) as unknown as { config: unknown };
    expect(x.config).toEqual(y.config);
  });

  it('the calibrated saturation flow still matches this engine (re-measured under heavy demand, default plan)', () => {
    const results = runExperiment({ profiles: [profileById('heavy')], controllers: [defaultFixed()], seeds: [1, 2], duration: 1800 });
    const flows = results.runs.flatMap((r) => Object.values(r.queues.phases).map((ph) => (ph.utilisation / 2) * 3600));
    const measured = flows.reduce((a, b) => a + b, 0) / flows.length;
    expect(measured).toBeGreaterThan(SATURATION_FLOW * 0.8);
    expect(measured).toBeLessThan(SATURATION_FLOW * 1.2);
  }, 120_000);
});
