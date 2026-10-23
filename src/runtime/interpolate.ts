import { NETWORK, poseAt } from '../sim/network';
import type { Approach, VehicleObservation } from '../sim/types';

export interface InterpolatedVehicle {
  id: number;
  approach: Approach;
  x: number;
  y: number;
  /** radians, counter-clockwise from +x (sim axes) */
  heading: number;
  speed: number;
  held: boolean;
}

/**
 * Pose of every vehicle between two fixed simulation steps. alpha = 0 gives `prev`, 1 gives `curr`.
 * Vehicles that appeared this step are drawn at their current position. Purely visual; never feeds back.
 */
export function interpolateVehicles(
  prev: readonly VehicleObservation[],
  curr: readonly VehicleObservation[],
  alpha: number,
  vehicleLength: number,
): InterpolatedVehicle[] {
  const before = new Map<number, VehicleObservation>();
  for (const p of prev) before.set(p.id, p);
  const a = Math.min(1, Math.max(0, alpha));
  return curr.map((v) => {
    const p = before.get(v.id);
    const s0 = p && p.routeIndex === v.routeIndex ? p.s : v.s;
    const s = s0 + (v.s - s0) * a;
    const pose = poseAt(NETWORK.routes[v.routeIndex], s - vehicleLength / 2);
    return { id: v.id, approach: v.approach, x: pose.x, y: pose.y, heading: pose.heading, speed: v.speed, held: v.held };
  });
}
