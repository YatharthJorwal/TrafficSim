import type { Arrival, Movement, SimConfig, TurnMix } from './types';
import { APPROACHES } from './types';
import { deriveSeed, mulberry32 } from './rng';

/**
 * Generate the full arrival schedule up front.
 *
 * Each approach draws from its own seeded stream, so (a) the schedule is a pure function of the
 * config and (b) changing one approach's demand never perturbs another approach's arrivals.
 * Both controllers in an experiment receive the identical schedule.
 */
/** Seconds between spawns at the same entry when the fleet is first placed. */
export const SPAWN_INTERVAL = 2.5;

export function pickMovement(mix: TurnMix, u: number): Movement {
  const total = mix.left + mix.straight + mix.right;
  if (!(total > 0)) return 'straight';
  const x = u * total;
  return x < mix.left ? 'left' : x < mix.left + mix.straight ? 'straight' : 'right';
}

/** Vehicle number `index` (0-based) of a circulating fleet, spawning at `time` at the entry `index % 4`. */
export function fleetArrival(config: SimConfig, index: number, time: number): Arrival {
  const approach = APPROACHES[index % APPROACHES.length];
  const rng = mulberry32(deriveSeed(config.seed, 1000 + index));
  const movement = pickMovement(config.demand[approach].turnMix, rng());
  const speedFactor = 1 + (rng() * 2 - 1) * config.speedVariation;
  return { id: index + 1, time, approach, movement, speedFactor };
}

export function generateSchedule(config: SimConfig): Arrival[] {
  if (config.mode === 'circulating') {
    return Array.from({ length: config.fleet }, (_, i) => fleetArrival(config, i, Math.floor(i / APPROACHES.length) * SPAWN_INTERVAL));
  }
  const drafts: Omit<Arrival, 'id'>[] = [];

  APPROACHES.forEach((approach, idx) => {
    const d = config.demand[approach];
    if (d.ratePerHour <= 0) return;
    const rng = mulberry32(deriveSeed(config.seed, idx));
    const lambda = d.ratePerHour / 3600;
    const { left, straight, right } = d.turnMix;
    const total = left + straight + right;
    const pLeft = left / total;
    const pStraightEnd = (left + straight) / total;

    let t = 0;
    for (;;) {
      t += -Math.log(1 - rng()) / lambda;
      if (t >= config.duration) break;
      const u = rng();
      const movement: Movement = u < pLeft ? 'left' : u < pStraightEnd ? 'straight' : 'right';
      const speedFactor = 1 + (rng() * 2 - 1) * config.speedVariation;
      drafts.push({ time: t, approach, movement, speedFactor });
    }
  });

  drafts.sort((a, b) => a.time - b.time || APPROACHES.indexOf(a.approach) - APPROACHES.indexOf(b.approach));
  return drafts.map((d, i) => ({ id: i + 1, ...d }));
}
