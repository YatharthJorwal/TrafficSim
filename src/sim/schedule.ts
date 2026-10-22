import type { Arrival, Movement, SimConfig } from './types';
import { APPROACHES } from './types';
import { deriveSeed, mulberry32 } from './rng';

/**
 * Generate the full arrival schedule up front.
 *
 * Each approach draws from its own seeded stream, so (a) the schedule is a pure function of the
 * config and (b) changing one approach's demand never perturbs another approach's arrivals.
 * Both controllers in an experiment receive the identical schedule.
 */
export function generateSchedule(config: SimConfig): Arrival[] {
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
