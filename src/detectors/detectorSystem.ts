import { APPROACHES, type Approach, type VehicleObservation } from '../sim/types';
import {
  DetectorConfigError,
  type DetectorConfig,
  type DetectorEvent,
  type DetectorTotals,
  type Measurements,
  type ApproachMeasurement,
} from './types';

export const DEFAULT_DETECTOR_CONFIG: DetectorConfig = {
  zoneLength: 80,
  observationWindow: 60,
  stoppedSpeed: 0.5,
  queueChainGap: 8,
  vehicleLength: 4.5,
};

/** Estimates need at least this much data (s). */
const MIN_ESTIMATE_TIME = 10;

export function createDetectorConfig(overrides: Partial<DetectorConfig> = {}, vehicleLength?: number): DetectorConfig {
  const config = { ...DEFAULT_DETECTOR_CONFIG, ...(vehicleLength !== undefined ? { vehicleLength } : {}), ...overrides };
  const e: string[] = [];
  const ok = (n: number) => Number.isFinite(n);
  if (!ok(config.zoneLength) || config.zoneLength < 10 || config.zoneLength > 90) e.push('zoneLength must be between 10 and 90 m');
  if (!ok(config.observationWindow) || config.observationWindow < 5) e.push('observationWindow must be at least 5 s');
  if (!ok(config.stoppedSpeed) || config.stoppedSpeed <= 0 || config.stoppedSpeed > 3) e.push('stoppedSpeed must be in (0, 3] m/s');
  if (!ok(config.queueChainGap) || config.queueChainGap <= 0) e.push('queueChainGap must be positive');
  if (!ok(config.vehicleLength) || config.vehicleLength <= 0) e.push('vehicleLength must be positive');
  if (e.length) throw new DetectorConfigError(e);
  return config;
}

interface Zone {
  present: Map<number, { wait: number }>;
  arrivalTimes: number[];
  departureTimes: number[];
  totals: DetectorTotals;
}

const newZone = (): Zone => ({
  present: new Map(),
  arrivalTimes: [],
  departureTimes: [],
  totals: { arrivals: 0, departures: 0, peakQueueCount: 0, peakQueueLengthM: 0, peakWait: 0 },
});

const emptyMeasurement = (): ApproachMeasurement => ({
  observed: { inZone: 0, approaching: 0, queueLength: 0, queueLengthM: 0, zoneOverflow: false, avgWait: 0, maxWait: 0, arrivals: 0, departures: 0 },
  estimated: { demandVehPerHour: 0 },
});

/**
 * Virtual detector zone on each approach, simulating a roadside camera / inductive loop.
 * It sees only presence and speed of vehicles inside its zone, never routes or intentions, and is
 * sampled once per simulation step. It never changes the simulation.
 */
export class DetectorSystem {
  readonly config: DetectorConfig;
  /** Append-only arrival / departure log since the last reset. */
  readonly events: DetectorEvent[] = [];

  private zones: Record<Approach, Zone> = { N: newZone(), E: newZone(), S: newZone(), W: newZone() };
  private current: Measurements = this.zeroMeasurements();

  constructor(config: DetectorConfig) {
    this.config = config;
  }

  get measurements(): Readonly<Measurements> {
    return this.current;
  }

  totals(approach: Approach): Readonly<DetectorTotals> {
    return this.zones[approach].totals;
  }

  reset(): void {
    this.zones = { N: newZone(), E: newZone(), S: newZone(), W: newZone() };
    this.events.length = 0;
    this.current = this.zeroMeasurements();
  }

  /** Sample the detectors. `time` is the simulation time after the step; `dt` the step length. */
  update(time: number, dt: number, vehicles: readonly VehicleObservation[]): void {
    const { zoneLength, observationWindow, stoppedSpeed, queueChainGap, vehicleLength } = this.config;

    const buckets: Record<Approach, VehicleObservation[]> = { N: [], E: [], S: [], W: [] };
    for (const v of vehicles) {
      if (v.distanceToStopLine >= 0 && v.distanceToStopLine < zoneLength) buckets[v.approach].push(v);
    }

    const next = {} as Measurements;
    for (const approach of APPROACHES) {
      const zone = this.zones[approach];
      const inZone = buckets[approach].sort((a, b) => a.distanceToStopLine - b.distanceToStopLine || a.id - b.id);
      const seen = new Set<number>();

      for (const v of inZone) {
        seen.add(v.id);
        let entry = zone.present.get(v.id);
        if (!entry) {
          entry = { wait: 0 };
          zone.present.set(v.id, entry);
          zone.arrivalTimes.push(time);
          zone.totals.arrivals++;
          this.events.push({ time, approach, type: 'arrival', vehicleId: v.id });
        }
        if (v.speed < stoppedSpeed) entry.wait += dt;
      }
      for (const [id, entry] of zone.present) {
        if (seen.has(id)) continue;
        zone.present.delete(id);
        zone.departureTimes.push(time);
        zone.totals.departures++;
        zone.totals.peakWait = Math.max(zone.totals.peakWait, entry.wait);
        this.events.push({ time, approach, type: 'departure', vehicleId: id, waitInZone: entry.wait });
      }

      const cutoff = time - observationWindow;
      while (zone.arrivalTimes.length && zone.arrivalTimes[0] < cutoff) zone.arrivalTimes.shift();
      while (zone.departureTimes.length && zone.departureTimes[0] < cutoff) zone.departureTimes.shift();

      // Queue: stopped vehicles chained back from the stop line.
      let queueCount = 0;
      let prev: VehicleObservation | null = null;
      for (const v of inZone) {
        if (v.speed >= stoppedSpeed) break;
        const gap = prev === null ? v.distanceToStopLine : v.distanceToStopLine - prev.distanceToStopLine - vehicleLength;
        if (gap > queueChainGap) break;
        queueCount++;
        prev = v;
      }
      const queueLengthM = prev ? prev.distanceToStopLine + vehicleLength : 0;
      const zoneOverflow = prev !== null && queueLengthM + queueChainGap >= zoneLength;

      let waitSum = 0;
      let maxWait = 0;
      for (const v of inZone) {
        const w = zone.present.get(v.id)!.wait;
        waitSum += w;
        if (w > maxWait) maxWait = w;
      }
      zone.totals.peakWait = Math.max(zone.totals.peakWait, maxWait);
      zone.totals.peakQueueCount = Math.max(zone.totals.peakQueueCount, queueCount);
      zone.totals.peakQueueLengthM = Math.max(zone.totals.peakQueueLengthM, queueLengthM);

      const elapsed = Math.min(observationWindow, time);
      next[approach] = {
        observed: {
          inZone: inZone.length,
          approaching: inZone.filter((v) => v.speed >= stoppedSpeed).length,
          queueLength: queueCount,
          queueLengthM,
          zoneOverflow,
          avgWait: inZone.length ? waitSum / inZone.length : 0,
          maxWait,
          arrivals: zone.arrivalTimes.length,
          departures: zone.departureTimes.length,
        },
        estimated: {
          demandVehPerHour: elapsed >= MIN_ESTIMATE_TIME ? (zone.arrivalTimes.length / elapsed) * 3600 : 0,
        },
      };
    }
    this.current = next;
  }

  private zeroMeasurements(): Measurements {
    return { N: emptyMeasurement(), E: emptyMeasurement(), S: emptyMeasurement(), W: emptyMeasurement() };
  }
}
