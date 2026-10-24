import type { Approach, Movement, Pose, Vec2 } from './types';
import { APPROACHES, MOVEMENTS } from './types';

/** Fixed road geometry (metres). One lane per direction per arm, right-hand traffic. */
export const GEOMETRY = {
  /** Lane centre offset from the road centreline. */
  laneOffset: 1.75,
  /** Intersection box half-width. */
  boxHalf: 5,
  /** Stop line distance from the intersection centre (leaves room for a crosswalk between line and box). */
  stopLineDist: 9.5,
  /** Distance from centre to vehicle entry / exit points. */
  armLength: 100,
  /** Paths closer than this inside the box are treated as conflicting. */
  crossingClearance: 3.0,
  curveSamples: 24,
  /** Speed limit through turns. */
  turnSpeed: { left: 5.0, right: 4.0 },
} as const;

export const OPPOSITE: Record<Approach, Approach> = { N: 'S', S: 'N', E: 'W', W: 'E' };

export const ARM_DIR: Record<Approach, Vec2> = {
  N: { x: 0, y: 1 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: -1 },
  W: { x: -1, y: 0 },
};

const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
const rightOf = (d: Vec2): Vec2 => ({ x: d.y, y: -d.x });
const leftOf = (d: Vec2): Vec2 => ({ x: -d.y, y: d.x });

function armOfDirection(e: Vec2): Approach {
  for (const a of APPROACHES) if (ARM_DIR[a].x === e.x && ARM_DIR[a].y === e.y) return a;
  throw new Error('direction is not axis aligned');
}

export interface Route {
  index: number;
  id: string;
  approach: Approach;
  movement: Movement;
  /** Arm the vehicle leaves along. */
  exit: Approach;
  points: Vec2[];
  /** Cumulative arc length at each point. */
  cum: number[];
  length: number;
  /** Arc length at which the front bumper reaches the stop line. */
  stopLineS: number;
  /** Arc length at the intersection box boundary on entry / exit. */
  boxEnterS: number;
  boxExitS: number;
  /** Speed limit in the turn (Infinity for straight movements). */
  turnSpeed: number;
}

/** 'crossing' paths intersect inside the box; 'merging' paths end in the same exit lane. */
export type ConflictKind = 'none' | 'crossing' | 'merging';

export interface Network {
  routes: readonly Route[];
  conflicts: readonly (readonly ConflictKind[])[];
  route(approach: Approach, movement: Movement): Route;
}

function buildRoute(index: number, approach: Approach, movement: Movement): Route {
  const { laneOffset: off, boxHalf: H, armLength: L, stopLineDist, curveSamples: n } = GEOMETRY;
  const d = scale(ARM_DIR[approach], -1); // travel direction on the way in
  const r = rightOf(d);
  const e = movement === 'straight' ? d : movement === 'right' ? r : leftOf(d);
  const re = rightOf(e);

  const entry = add(scale(d, -L), scale(r, off));
  const p0 = add(scale(d, -H), scale(r, off));
  const p2 = add(scale(e, H), scale(re, off));
  const exitEnd = add(scale(e, L), scale(re, off));

  const pts: Vec2[] = [entry];
  if (movement === 'straight') {
    pts.push(p0, p2);
  } else {
    // Quadratic Bezier; control point sits where the two lane lines meet.
    const p1 = add(p0, scale(d, dot(sub(p2, p0), d)));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const c = t * t;
      pts.push({ x: a * p0.x + b * p1.x + c * p2.x, y: a * p0.y + b * p1.y + c * p2.y });
    }
  }
  pts.push(exitEnd);

  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }

  return {
    index,
    id: `${approach}-${movement}`,
    approach,
    movement,
    exit: armOfDirection(e),
    points: pts,
    cum,
    length: cum[cum.length - 1],
    stopLineS: L - stopLineDist,
    boxEnterS: cum[1],
    boxExitS: cum[pts.length - 2],
    turnSpeed: movement === 'straight' ? Infinity : GEOMETRY.turnSpeed[movement],
  };
}

/** Pose at arc length s. Extrapolates along the first / last segment outside [0, length]. */
export function poseAt(route: Route, s: number): Pose {
  const { points, cum } = route;
  const last = points.length - 2;
  let i: number;
  if (s <= 0) i = 0;
  else if (s >= route.length) i = last;
  else {
    let lo = 0;
    let hi = last;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    i = lo;
  }
  const a = points[i];
  const b = points[i + 1];
  const segLen = cum[i + 1] - cum[i];
  const ux = (b.x - a.x) / segLen;
  const uy = (b.y - a.y) / segLen;
  const t = s - cum[i];
  return { x: a.x + ux * t, y: a.y + uy * t, heading: Math.atan2(uy, ux) };
}

function classify(a: Route, b: Route): ConflictKind {
  if (a.approach === b.approach) return 'none';
  if (a.exit === b.exit) return 'merging';
  const step = 0.5;
  const limit = GEOMETRY.crossingClearance;
  for (let sa = a.boxEnterS; sa <= a.boxExitS; sa += step) {
    const pa = poseAt(a, sa);
    for (let sb = b.boxEnterS; sb <= b.boxExitS; sb += step) {
      const pb = poseAt(b, sb);
      if (Math.hypot(pa.x - pb.x, pa.y - pb.y) < limit) return 'crossing';
    }
  }
  return 'none';
}

export function buildNetwork(): Network {
  const routes: Route[] = [];
  for (const a of APPROACHES) for (const m of MOVEMENTS) routes.push(buildRoute(routes.length, a, m));
  const conflicts = routes.map((a) => routes.map((b) => classify(a, b)));
  const lookup = new Map(routes.map((r) => [r.id, r]));
  return {
    routes,
    conflicts,
    route: (approach, movement) => lookup.get(`${approach}-${movement}`)!,
  };
}

export const NETWORK: Network = buildNetwork();
