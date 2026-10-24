import { NETWORK, poseAt } from '../sim/network';
import type { Approach, Movement, VehicleObservation } from '../sim/types';

export interface InterpolatedVehicle {
  id: number;
  approach: Approach;
  x: number;
  y: number;
  /** radians, counter-clockwise from +x (sim axes) */
  heading: number;
  speed: number;
  held: boolean;
  movement: Movement;
  /** Brake lights on: stopped, or slowing down. */
  braking: boolean;
  /** Which indicator a turning vehicle should flash (from 35 m before the stop line until it leaves the box). */
  indicator: 'left' | 'right' | null;
  /** 0..1 scale so vehicles grow in at the entry point and shrink away at the exit instead of popping. */
  fade: number;
}

const FADE_DISTANCE = 12;
const smoothstep = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

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
    const route = NETWORK.routes[v.routeIndex];
    const pose = poseAt(route, s - vehicleLength / 2);
    const slowing = p !== undefined && p.routeIndex === v.routeIndex && v.speed < p.speed - 0.015;
    const turning = v.movement !== 'straight' && s > route.stopLineS - 35 && s < route.boxExitS + 1;
    return {
      id: v.id, approach: v.approach, x: pose.x, y: pose.y, heading: pose.heading, speed: v.speed, held: v.held,
      movement: v.movement,
      braking: v.speed < 0.3 || slowing,
      indicator: turning ? (v.movement as 'left' | 'right') : null,
      fade: Math.min(smoothstep(s / FADE_DISTANCE), smoothstep((route.length - s) / FADE_DISTANCE)),
    };
  });
}
