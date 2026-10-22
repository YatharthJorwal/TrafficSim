import type { Approach, ApproachDemand, SimConfig, TurnMix, VehicleParams } from './types';
import { APPROACHES } from './types';

export const DEFAULT_VEHICLE: VehicleParams = {
  length: 4.5,
  width: 1.9,
  maxAccel: 1.5,
  comfortDecel: 2.0,
  maxDecel: 8.0,
  timeHeadway: 1.3,
  minGap: 2.0,
  maxJerkUp: 2.5,
  maxJerkDown: 15,
  freeSpeed: 13.9, // ~50 km/h
};

export const DEFAULT_TURN_MIX: TurnMix = { left: 0.2, straight: 0.6, right: 0.2 };

export function uniformDemand(
  ratePerHour: number,
  turnMix: TurnMix = DEFAULT_TURN_MIX,
): Record<Approach, ApproachDemand> {
  return {
    N: { ratePerHour, turnMix: { ...turnMix } },
    E: { ratePerHour, turnMix: { ...turnMix } },
    S: { ratePerHour, turnMix: { ...turnMix } },
    W: { ratePerHour, turnMix: { ...turnMix } },
  };
}

export interface ConfigOverrides {
  seed?: number;
  duration?: number;
  dt?: number;
  speedVariation?: number;
  demand?: Partial<Record<Approach, Partial<ApproachDemand>>>;
  vehicle?: Partial<VehicleParams>;
}

/** Build a complete config from defaults plus overrides. Does not validate; the engine does. */
export function createConfig(overrides: ConfigOverrides = {}): SimConfig {
  const demand = uniformDemand(400);
  for (const a of APPROACHES) {
    const o = overrides.demand?.[a];
    if (!o) continue;
    if (o.ratePerHour !== undefined) demand[a].ratePerHour = o.ratePerHour;
    if (o.turnMix) demand[a].turnMix = { ...o.turnMix };
  }
  return {
    seed: overrides.seed ?? 1,
    duration: overrides.duration ?? 3600,
    dt: overrides.dt ?? 0.05,
    speedVariation: overrides.speedVariation ?? 0.1,
    demand,
    vehicle: { ...DEFAULT_VEHICLE, ...overrides.vehicle },
  };
}

export class ConfigError extends Error {
  readonly issues: readonly string[];
  constructor(issues: string[]) {
    super(`Invalid simulation config:\n - ${issues.join('\n - ')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Returns a list of human-readable problems; empty means valid. */
export function validateConfig(c: SimConfig): string[] {
  const e: string[] = [];
  if (!finite(c.seed)) e.push('seed must be a finite number');
  if (!finite(c.duration) || c.duration <= 0 || c.duration > 86400) e.push('duration must be in (0, 86400] seconds');
  if (!finite(c.dt) || c.dt < 0.01 || c.dt > 0.2) e.push('dt must be in [0.01, 0.2] seconds');
  if (!finite(c.speedVariation) || c.speedVariation < 0 || c.speedVariation >= 0.5)
    e.push('speedVariation must be in [0, 0.5)');

  for (const a of APPROACHES) {
    const d = c.demand?.[a];
    if (!d) {
      e.push(`demand.${a} is missing`);
      continue;
    }
    if (!finite(d.ratePerHour) || d.ratePerHour < 0 || d.ratePerHour > 4000)
      e.push(`demand.${a}.ratePerHour must be in [0, 4000]`);
    const m = d.turnMix;
    if (!m || ![m.left, m.straight, m.right].every((x) => finite(x) && x >= 0)) {
      e.push(`demand.${a}.turnMix weights must be finite and >= 0`);
    } else if (d.ratePerHour > 0 && m.left + m.straight + m.right <= 0) {
      e.push(`demand.${a}.turnMix must have a positive total when ratePerHour > 0`);
    }
  }

  const v = c.vehicle;
  const positive: (keyof VehicleParams)[] = [
    'length', 'width', 'maxAccel', 'comfortDecel', 'maxDecel', 'timeHeadway',
    'minGap', 'maxJerkUp', 'maxJerkDown', 'freeSpeed',
  ];
  for (const k of positive) if (!finite(v?.[k]) || v[k] <= 0) e.push(`vehicle.${k} must be a positive number`);
  if (finite(v?.maxDecel) && finite(v?.comfortDecel) && v.maxDecel < v.comfortDecel)
    e.push('vehicle.maxDecel must be >= vehicle.comfortDecel');
  if (finite(v?.freeSpeed) && v.freeSpeed > 40) e.push('vehicle.freeSpeed must be <= 40 m/s');
  return e;
}

export function assertValidConfig(c: SimConfig): void {
  const issues = validateConfig(c);
  if (issues.length) throw new ConfigError(issues);
}
