import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMING, FixedTimeController, TWO_PHASE_PLAN, planFromCycle, type ControllerInput, type SignalController } from '../control';
import { SimulationRunner } from '../runtime';
import { createConfig, uniformDemand } from '../sim/config';
import { APPROACHES, type Approach, type VehicleObservation } from '../sim/types';
import { DetectorConfigError, DetectorSystem, createDetectorConfig } from './index';

const DT = 0.05;
const LEN = 4.5;
const cfg = (o = {}) => createDetectorConfig({ zoneLength: 80, observationWindow: 60, ...o }, LEN);

let nextId = 1;
const obs = (approach: Approach, distanceToStopLine: number, speed: number, id = nextId++): VehicleObservation => ({
  id, routeIndex: 0, approach, movement: 'straight', s: 94 - distanceToStopLine, speed, distanceToStopLine, held: false, leg: 0, persistent: false,
});

describe('detector config', () => {
  it('validates', () => {
    expect(() => createDetectorConfig({ zoneLength: 5 })).toThrow(DetectorConfigError);
    expect(() => createDetectorConfig({ zoneLength: 200 })).toThrow(/zoneLength/);
    expect(() => createDetectorConfig({ observationWindow: 1 })).toThrow(/observationWindow/);
    expect(() => createDetectorConfig({ stoppedSpeed: 0 })).toThrow(/stoppedSpeed/);
    expect(createDetectorConfig().zoneLength).toBe(80);
  });
});

describe('arrival and departure events', () => {
  it('logs one arrival when a vehicle enters the zone and one departure when it crosses the stop line', () => {
    const d = new DetectorSystem(cfg());
    const id = 7;
    let t = 0;
    for (const dist of [95, 85, 79.9, 60, 30, 5, 0.2, -0.3, -4]) {
      t += DT;
      d.update(t, DT, [obs('N', dist, 10, id)]);
    }
    const ev = d.events.filter((e) => e.vehicleId === id);
    expect(ev.map((e) => e.type)).toEqual(['arrival', 'departure']);
    expect(ev[0].approach).toBe('N');
    expect(d.totals('N')).toMatchObject({ arrivals: 1, departures: 1 });
    expect(d.totals('S')).toMatchObject({ arrivals: 0, departures: 0 });
    expect(d.measurements.N.observed.inZone).toBe(0);
  });

  it('keeps approaches separate', () => {
    const d = new DetectorSystem(cfg());
    d.update(DT, DT, [obs('N', 40, 10), obs('E', 40, 10), obs('E', 20, 10)]);
    expect(d.measurements.N.observed.inZone).toBe(1);
    expect(d.measurements.E.observed.inZone).toBe(2);
    expect(d.measurements.S.observed.inZone).toBe(0);
  });
});

describe('observed measurements', () => {
  it('separates approaching vehicles from the queue', () => {
    const d = new DetectorSystem(cfg());
    const vs = [obs('N', 0.5, 0), obs('N', 7, 0), obs('N', 13.5, 0), obs('N', 40, 12), obs('N', 60, 11)];
    d.update(DT, DT, vs);
    const o = d.measurements.N.observed;
    expect(o.inZone).toBe(5);
    expect(o.queueLength).toBe(3);
    expect(o.approaching).toBe(2);
    expect(o.queueLengthM).toBeCloseTo(13.5 + LEN, 9);
    expect(o.zoneOverflow).toBe(false);
  });

  it('breaks the queue at a gap larger than the chain gap, or at a moving vehicle', () => {
    const gapped = new DetectorSystem(cfg());
    gapped.update(DT, DT, [obs('N', 0.5, 0), obs('N', 30, 0)]);
    expect(gapped.measurements.N.observed.queueLength).toBe(1);
    const farHead = new DetectorSystem(cfg());
    farHead.update(DT, DT, [obs('N', 20, 0), obs('N', 26.5, 0)]);
    expect(farHead.measurements.N.observed.queueLength).toBe(0);
    const moving = new DetectorSystem(cfg());
    moving.update(DT, DT, [obs('N', 0.5, 0), obs('N', 7, 3), obs('N', 13.5, 0)]);
    expect(moving.measurements.N.observed.queueLength).toBe(1);
  });

  it('flags zone overflow when the queue reaches the upstream end of the zone', () => {
    const d = new DetectorSystem(cfg());
    const vs: VehicleObservation[] = [];
    for (let i = 0; i < 12; i++) vs.push(obs('N', 0.5 + i * 6.5, 0));
    d.update(DT, DT, vs);
    expect(d.measurements.N.observed.queueLength).toBe(12);
    expect(d.measurements.N.observed.zoneOverflow).toBe(true);
  });

  it('accumulates waiting time only while stopped inside the zone', () => {
    const d = new DetectorSystem(cfg());
    const a = obs('N', 0.5, 0, 1);
    const b = obs('N', 7, 0, 2);
    for (let k = 1; k <= 200; k++) d.update(k * DT, DT, [a, b]);
    // both stopped for 10 s
    expect(d.measurements.N.observed.maxWait).toBeCloseTo(10, 6);
    expect(d.measurements.N.observed.avgWait).toBeCloseTo(10, 6);
    // one starts moving: its wait stops growing, the other keeps growing
    const moving = { ...b, speed: 5 };
    for (let k = 201; k <= 400; k++) d.update(k * DT, DT, [a, moving]);
    expect(d.measurements.N.observed.maxWait).toBeCloseTo(20, 6);
    expect(d.measurements.N.observed.avgWait).toBeCloseTo(15, 6);
    // departure event reports the vehicle's wait
    d.update(401 * DT, DT, [moving]);
    const dep = d.events.find((e) => e.type === 'departure' && e.vehicleId === 1)!;
    expect(dep.waitInZone).toBeCloseTo(20, 6);
    expect(d.totals('N').peakWait).toBeGreaterThanOrEqual(20 - 1e-6);
  });

  it('tracks peaks and resets cleanly', () => {
    const d = new DetectorSystem(cfg());
    d.update(DT, DT, [obs('N', 0.5, 0), obs('N', 7, 0), obs('N', 13.5, 0)]);
    d.update(2 * DT, DT, [obs('N', 0.5, 0)]);
    expect(d.totals('N').peakQueueCount).toBe(3);
    expect(d.totals('N').peakQueueLengthM).toBeCloseTo(18, 9);
    d.reset();
    expect(d.events).toHaveLength(0);
    expect(d.totals('N').peakQueueCount).toBe(0);
    expect(d.measurements.N.observed.inZone).toBe(0);
  });
});

describe('windowed counts and the demand estimate', () => {
  it('counts arrivals inside the window only and scales them to veh/h as an estimate', () => {
    const d = new DetectorSystem(cfg({ observationWindow: 60 }));
    let t = 0;
    let id = 1000;
    for (let k = 0; k < 40 * 20; k++) {
      t += DT;
      const vs: VehicleObservation[] = [];
      // one new vehicle every 5 s sitting just inside the zone edge for a single sample
      if (k % 100 === 0) vs.push(obs('E', 79, 10, id++));
      d.update(t, DT, vs);
    }
    // 40 s elapsed, 8 arrivals
    expect(d.measurements.E.observed.arrivals).toBe(8);
    expect(d.measurements.E.estimated.demandVehPerHour).toBeCloseTo((8 / 40) * 3600, 6);
    // run on to 130 s: window now covers the last 60 s only (12 arrivals at one per 5 s)
    for (let k = 0; k < 90 * 20; k++) {
      t += DT;
      const vs: VehicleObservation[] = [];
      if (k % 100 === 0) vs.push(obs('E', 79, 10, id++));
      d.update(t, DT, vs);
    }
    expect(d.measurements.E.observed.arrivals).toBeGreaterThanOrEqual(11);
    expect(d.measurements.E.observed.arrivals).toBeLessThanOrEqual(12);
    expect(d.measurements.E.estimated.demandVehPerHour).toBeGreaterThan(600);
    expect(d.measurements.E.estimated.demandVehPerHour).toBeLessThan(800);
  });

  it('gives no estimate before 10 s of data', () => {
    const d = new DetectorSystem(cfg());
    d.update(5, 5, [obs('N', 50, 10)]);
    expect(d.measurements.N.observed.arrivals).toBe(1);
    expect(d.measurements.N.estimated.demandVehPerHour).toBe(0);
  });
});

describe('detectors against the real engine', () => {
  const config = createConfig({ seed: 5, duration: 600 });
  config.demand = uniformDemand(350);
  const plan = planFromCycle(TWO_PHASE_PLAN, DEFAULT_TIMING, 60);
  const fixed = () => new FixedTimeController(TWO_PHASE_PLAN, DEFAULT_TIMING, plan);

  it('departures equal stop-line crossings, and arrivals minus departures equal vehicles in the zone', () => {
    const r = new SimulationRunner(config, fixed(), { diagnostics: false });
    r.run(600);
    for (const a of APPROACHES) {
      expect(r.detectors.totals(a).departures).toBe(r.engine.stats.perApproach[a].enteredIntersection);
      const t = r.detectors.totals(a);
      expect(t.arrivals - t.departures).toBe(r.detectors.measurements[a].observed.inZone);
      expect(t.arrivals).toBeLessThanOrEqual(r.engine.stats.perApproach[a].inserted);
    }
    expect(r.detectors.events.length).toBe(APPROACHES.reduce((n, a) => n + r.detectors.totals(a).arrivals + r.detectors.totals(a).departures, 0));
  });

  it('matches a ground-truth queue count taken straight from the engine on a red', () => {
    const only = createConfig({ seed: 2, duration: 200 });
    only.demand = uniformDemand(0);
    only.demand.N = { ratePerHour: 900, turnMix: { left: 0, straight: 1, right: 0 } };
    const r = new SimulationRunner(only, fixed(), { diagnostics: false });
    r.setDebugOverride({ N: 'red', E: 'red', S: 'red', W: 'red' });
    r.run(150);
    const truth = r.engine
      .observe()
      .filter((v) => v.approach === 'N' && v.speed < 0.5 && v.distanceToStopLine < 80)
      .length;
    const m = r.detectors.measurements.N.observed;
    expect(m.queueLength).toBeGreaterThan(5);
    expect(m.queueLength).toBeLessThanOrEqual(truth);
    expect(m.queueLength).toBeGreaterThanOrEqual(truth - 1);
    expect(m.maxWait).toBeGreaterThan(20);
    expect(r.detectors.measurements.E.observed.inZone).toBe(0);
  });

  it('the observed demand estimate is in the right range for steady demand', () => {
    const steady = createConfig({ seed: 9, duration: 900 });
    steady.demand = uniformDemand(0);
    steady.demand.S = { ratePerHour: 600, turnMix: { left: 0, straight: 1, right: 0 } };
    const r = new SimulationRunner(steady, fixed(), { detectors: { observationWindow: 300 } });
    r.run(600);
    const est = r.detectors.measurements.S.estimated.demandVehPerHour;
    expect(est).toBeGreaterThan(600 * 0.7);
    expect(est).toBeLessThan(600 * 1.3);
  });

  it('passes measurements to the controller on every tick, starting with the first', () => {
    const seen: ControllerInput[] = [];
    const spy: SignalController = {
      name: 'spy',
      reset() { seen.length = 0; },
      decide(input) { seen.push(input); return null; },
    };
    const r = new SimulationRunner(config, spy);
    r.run(30);
    expect(seen.length).toBe(600);
    expect(seen[0].measurements).toBeDefined();
    expect(seen[0].measurements!.N.observed.inZone).toBe(0);
    expect(seen[10].measurements).not.toBe(seen[11].measurements);
    expect(seen.some((s) => s.measurements!.N.observed.inZone + s.measurements!.E.observed.inZone > 0)).toBe(true);
  });

  it('detector sampling does not change the simulation', () => {
    const a = new SimulationRunner(config, fixed(), { detectors: { zoneLength: 30 } });
    const b = new SimulationRunner(config, fixed(), { detectors: { zoneLength: 90, observationWindow: 20 } });
    a.run(300);
    b.run(300);
    expect(a.engine.stateKey()).toBe(b.engine.stateKey());
  });

  it('is deterministic and reset clears it', () => {
    const run = () => {
      const r = new SimulationRunner(config, fixed());
      r.run(200);
      return JSON.stringify([r.detectors.events, r.detectors.measurements]);
    };
    expect(run()).toBe(run());
    const r = new SimulationRunner(config, fixed());
    r.run(100);
    r.reset();
    expect(r.detectors.events).toHaveLength(0);
    expect(r.detectors.measurements.N.observed.inZone).toBe(0);
  });
});
