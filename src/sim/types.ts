/**
 * Core simulation types. Nothing in src/sim may import React or Three.js.
 * Units: metres, seconds, m/s. World axes: +x east, +y north. Traffic drives on the right.
 */

/** The arm a vehicle arrives from (N = vehicles travelling southbound). */
export type Approach = 'N' | 'E' | 'S' | 'W';
export type Movement = 'left' | 'straight' | 'right';
export type SignalColor = 'green' | 'yellow' | 'red';
export type SignalStates = Record<Approach, SignalColor>;

export const APPROACHES: readonly Approach[] = ['N', 'E', 'S', 'W'];
export const MOVEMENTS: readonly Movement[] = ['left', 'straight', 'right'];

export interface Vec2 {
  x: number;
  y: number;
}
export interface Pose extends Vec2 {
  /** radians, atan2(dy, dx) */
  heading: number;
}

export interface TurnMix {
  left: number;
  straight: number;
  right: number;
}
export interface ApproachDemand {
  /** Mean arrival rate (Poisson), vehicles per hour. */
  ratePerHour: number;
  /** Relative weights; normalised internally. */
  turnMix: TurnMix;
}

export interface VehicleParams {
  length: number;
  width: number;
  /** IDM maximum acceleration (m/s^2) */
  maxAccel: number;
  /** IDM comfortable deceleration (m/s^2) */
  comfortDecel: number;
  /** Physical braking limit (m/s^2) */
  maxDecel: number;
  /** Desired time headway (s) */
  timeHeadway: number;
  /** Standstill gap (m) */
  minGap: number;
  /** Acceleration smoothing: max rate of increase of acceleration (m/s^3) */
  maxJerkUp: number;
  /** Acceleration smoothing: max rate of decrease of acceleration (m/s^3) */
  maxJerkDown: number;
  /** Mean free-flow speed (m/s) */
  freeSpeed: number;
}

export interface SimConfig {
  seed: number;
  /** Length of the arrival schedule / experiment horizon (s). */
  duration: number;
  /** Fixed simulation timestep (s). */
  dt: number;
  demand: Record<Approach, ApproachDemand>;
  /** Bounded per-vehicle free-speed variation: factor in [1-v, 1+v]. */
  speedVariation: number;
  vehicle: VehicleParams;
}

/** One pre-generated vehicle arrival. The schedule depends only on the config, never on the controller. */
export interface Arrival {
  id: number;
  time: number;
  approach: Approach;
  movement: Movement;
  speedFactor: number;
}

export interface VehicleSnapshot extends Pose {
  id: number;
  approach: Approach;
  movement: Movement;
  speed: number;
  accel: number;
  length: number;
  width: number;
  /** True while the vehicle is held back by a signal or a right-of-way yield. */
  held: boolean;
}

export interface SimSnapshot {
  time: number;
  vehicles: VehicleSnapshot[];
  signals: SignalStates;
}

/** Final record of a vehicle that left the network. */
export interface VehicleRecord {
  id: number;
  approach: Approach;
  movement: Movement;
  generatedAt: number;
  insertedAt: number;
  /** Time the front bumper crossed the stop line. */
  stopLineTime: number;
  exitedAt: number;
  /** Seconds at speed < 0.5 m/s upstream of the stop line. */
  waitingTime: number;
  /** Seconds at speed < 0.1 m/s anywhere in the network. */
  stoppedTime: number;
  ranRed: boolean;
}

export interface ApproachCounts {
  /** Arrivals whose scheduled time has passed (demand). */
  generated: number;
  /** Vehicles actually placed on the road (generated minus entry backlog). */
  inserted: number;
  /** Vehicles whose front crossed the stop line. */
  enteredIntersection: number;
  /** Vehicles that reached the end of their exit arm and were removed. */
  exited: number;
}

export interface EngineStats extends ApproachCounts {
  perApproach: Record<Approach, ApproachCounts>;
  /** Stop-line crossings while the signal showed red. */
  redLightEntries: number;
  /** Times the hard anti-overlap guard had to intervene (should stay 0). */
  safetyClamps: number;
  /** Diagnostics only: vehicle-pair/steps with overlapping bodies (should stay 0). */
  overlapPairSteps: number;
  firstOverlap: { time: number; a: number; b: number } | null;
  /** Smallest bumper-to-bumper gap seen between a vehicle and its leader. */
  minGap: number;
  maxSpeed: number;
  maxAccel: number;
  maxDecel: number;
}
