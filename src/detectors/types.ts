import type { Approach } from '../sim/types';

export interface DetectorConfig {
  /** Zone length measured upstream from the stop line (m). */
  zoneLength: number;
  /** Sliding window for arrival/departure counts and the demand estimate (s). */
  observationWindow: number;
  /** Speed below which a vehicle counts as stopped (m/s). */
  stoppedSpeed: number;
  /** Largest bumper gap that still links stopped vehicles into one queue (m). Also limits head-to-line distance. */
  queueChainGap: number;
  /** Vehicle length, used for bumper gaps and queue length (m). */
  vehicleLength: number;
}

/**
 * Directly sensed values: what a loop or camera at the zone could count and time.
 * Waiting time is the time a vehicle has spent stopped *inside the zone*.
 */
export interface ObservedMeasurement {
  /** Vehicles currently inside the zone (occupancy; > 0 means the detector is active). */
  inZone: number;
  /** Vehicles in the zone that are moving toward the stop line. */
  approaching: number;
  /** Vehicles in the queue: a chain of stopped vehicles starting at the stop line. */
  queueLength: number;
  /** Stop line to the rear bumper of the last queued vehicle (m). */
  queueLengthM: number;
  /** True when the queue may extend past the upstream end of the zone, so it is under-counted. */
  zoneOverflow: boolean;
  /** Mean accumulated stopped time of the vehicles currently in the zone (s). */
  avgWait: number;
  /** Largest accumulated stopped time of any vehicle currently in the zone (s). */
  maxWait: number;
  /** Vehicles that entered the zone within the observation window. */
  arrivals: number;
  /** Vehicles that crossed the stop line within the observation window. */
  departures: number;
}

/** Derived values. They are estimates and can be wrong (small samples, blocked zone, window length). */
export interface EstimatedMeasurement {
  /** Zone arrivals in the window scaled to veh/h. 0 until 10 s of data exist. */
  demandVehPerHour: number;
}

export interface ApproachMeasurement {
  observed: ObservedMeasurement;
  estimated: EstimatedMeasurement;
}
export type Measurements = Record<Approach, ApproachMeasurement>;

export interface DetectorEvent {
  time: number;
  approach: Approach;
  type: 'arrival' | 'departure';
  vehicleId: number;
  /** Departures only: seconds this vehicle spent stopped inside the zone. */
  waitInZone?: number;
}

/** Running totals since the last reset. */
export interface DetectorTotals {
  arrivals: number;
  departures: number;
  peakQueueCount: number;
  peakQueueLengthM: number;
  peakWait: number;
}

export class DetectorConfigError extends Error {
  readonly issues: readonly string[];
  constructor(issues: string[]) {
    super(`Invalid detector config:\n - ${issues.join('\n - ')}`);
    this.name = 'DetectorConfigError';
    this.issues = issues;
  }
}
