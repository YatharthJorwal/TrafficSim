import { ARM_DIR, GEOMETRY } from '../sim/network';
import type { Approach } from '../sim/types';

/** Sim axes (x east, y north) map to three.js (x, up, -z): north is "into the screen". */
export const toWorld = (x: number, y: number, up = 0): [number, number, number] => [x, up, -y];

export const ROAD_HALF = GEOMETRY.laneOffset * 2;

/**
 * Geometry helpers for one approach. `arm` points from the centre out along the arm; `right` points to the
 * right-hand side of a driver arriving on it (where that approach's lane sits).
 */
export function armBasis(a: Approach) {
  const arm = ARM_DIR[a];
  return { arm, right: { x: -arm.y, y: arm.x } };
}

/** Scale for a flat unit plane laid on the ground, long side `along` the arm and `across` it. */
export function flatScale(a: Approach, along: number, across: number): [number, number, number] {
  return Math.abs(ARM_DIR[a].x) === 1 ? [along, across, 1] : [across, along, 1];
}

/** Point `dist` metres out along the arm and `lateral` metres to the driver's right, as a sim (x, y). */
export function armPoint(a: Approach, dist: number, lateral: number): { x: number; y: number } {
  const { arm, right } = armBasis(a);
  return { x: arm.x * dist + right.x * lateral, y: arm.y * dist + right.y * lateral };
}
