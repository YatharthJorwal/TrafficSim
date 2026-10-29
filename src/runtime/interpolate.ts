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
  const half = vehicleLength / 2;
  return curr.map((v) => {
    const p = before.get(v.id);
    const route = NETWORK.routes[v.routeIndex];
    let x: number;
    let y: number;
    let heading: number;
    let s = v.s;
    if (p && p.routeIndex === v.routeIndex) {
      s = p.s + (v.s - p.s) * a;
      ({ x, y, heading } = poseAt(route, s - half));
    } else if (p) {
      // Handed over to another route this step (arm -> ring -> arm): blend the two poses.
      const from = poseAt(NETWORK.routes[p.routeIndex], p.s - half);
      const to = poseAt(route, v.s - half);
      x = from.x + (to.x - from.x) * a;
      y = from.y + (to.y - from.y) * a;
      heading = from.heading + Math.atan2(Math.sin(to.heading - from.heading), Math.cos(to.heading - from.heading)) * a;
    } else {
      ({ x, y, heading } = poseAt(route, v.s - half));
    }
    const slowing = p !== undefined && p.routeIndex === v.routeIndex && v.speed < p.speed - 0.015;
    const signal = route.signals.find((g) => s >= g.s0 && s <= g.s1 && (!g.ringOnly || v.persistent));
    // Fresh vehicles grow in at their spawn point; vehicles only shrink away at the end if they really leave.
    const fadeIn = v.leg === 0 ? smoothstep(s / FADE_DISTANCE) : 1;
    const fadeOut = v.persistent ? 1 : smoothstep((route.length - s) / FADE_DISTANCE);
    return {
      id: v.id, approach: v.approach, x, y, heading, speed: v.speed, held: v.held,
      movement: v.movement,
      braking: v.speed < 0.3 || slowing,
      indicator: signal ? signal.side : null,
      fade: Math.min(fadeIn, fadeOut),
    };
  });
}
