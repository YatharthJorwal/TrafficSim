import type { Pose } from './types';

/** Oriented-bounding-box overlap (separating axis test). Poses are body centres. */
export function obbOverlap(a: Pose, b: Pose, length: number, width: number, shrink = 0.95): boolean {
  const hl = (length * shrink) / 2;
  const hw = (width * shrink) / 2;
  const uax = Math.cos(a.heading);
  const uay = Math.sin(a.heading);
  const ubx = Math.cos(b.heading);
  const uby = Math.sin(b.heading);
  const axes: [number, number][] = [
    [uax, uay],
    [-uay, uax],
    [ubx, uby],
    [-uby, ubx],
  ];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [ax, ay] of axes) {
    const ra = hl * Math.abs(uax * ax + uay * ay) + hw * Math.abs(-uay * ax + uax * ay);
    const rb = hl * Math.abs(ubx * ax + uby * ay) + hw * Math.abs(-uby * ax + ubx * ay);
    if (Math.abs(dx * ax + dy * ay) > ra + rb) return false;
  }
  return true;
}
