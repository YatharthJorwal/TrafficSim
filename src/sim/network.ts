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

/** A stretch of a route with a speed limit (turns, corners). Vehicles brake early so they arrive at the limit. */
export interface LimitSegment {
  s0: number;
  s1: number;
  speed: number;
}
/** A stretch where a vehicle flashes an indicator (visual only). */
export interface TurnSignal {
  s0: number;
  s1: number;
  side: 'left' | 'right';
  /** Only shown in circulating mode (the vehicle really does turn onto the ring there). */
  ringOnly?: boolean;
}

export interface Route {
  index: number;
  id: string;
  /** 'main' crosses the intersection; 'connector' links an arm exit to an arm entry via the ring road. */
  kind: 'main' | 'connector';
  /** Main: arm the vehicle arrives from. Connector: the arm it will enter (its target). */
  approach: Approach;
  movement: Movement;
  /** Main: arm the vehicle leaves along. Connector: the arm it came out of. */
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
  limits: LimitSegment[];
  signals: TurnSignal[];
  /** Connectors only: arc length where the exit arc ends and the ring begins / ends and the turn into the arm begins. */
  ringStartS: number;
  ringEndS: number;
}

/** 'crossing' paths intersect inside the box; 'merging' paths end in the same exit lane. */
export type ConflictKind = 'none' | 'crossing' | 'merging';

export interface Network {
  /** The 12 main routes first (indices 0-11), then the 16 ring connectors. */
  routes: readonly Route[];
  conflicts: readonly (readonly ConflictKind[])[];
  route(approach: Approach, movement: Movement): Route;
  /** Connector from the exit of arm `from`, round the ring, into arm `to`. */
  connector(from: Approach, to: Approach): Route;
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

  const length = cum[cum.length - 1];
  const boxEnterS = cum[1];
  const boxExitS = cum[pts.length - 2];
  const turnSpeed = movement === 'straight' ? Infinity : GEOMETRY.turnSpeed[movement];
  const signals: TurnSignal[] = [{ s0: length - 25, s1: length, side: 'right', ringOnly: true }];
  if (movement !== 'straight') signals.unshift({ s0: L - stopLineDist - 35, s1: boxExitS + 1, side: movement });
  return {
    index,
    id: `${approach}-${movement}`,
    kind: 'main',
    approach,
    movement,
    exit: armOfDirection(e),
    points: pts,
    cum,
    length,
    stopLineS: L - stopLineDist,
    boxEnterS,
    boxExitS,
    turnSpeed,
    limits: turnSpeed === Infinity ? [] : [{ s0: boxEnterS, s1: boxExitS, speed: turnSpeed }],
    signals,
    ringStartS: Infinity,
    ringEndS: Infinity,
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

// ---------------------------------------------------------------------------------------------
// Ring road: a closed one-way loop (clockwise seen from above) around the city. Each arm meets it in a
// T-junction with right turns only: the exit lane curves right onto the ring, and ring traffic curves
// right into the arm's entry lane. Everything is built once for the north arm and rotated for the others.

export const RING = (() => {
  const L = GEOMETRY.armLength;
  const rho = 6; // junction (slip) radius
  const C = 20; // ring corner radius
  const D = L + rho; // ring lane distance from the centre line
  const off = GEOMETRY.laneOffset;
  return { armLength: L, junctionRadius: rho, cornerRadius: C, laneDist: D, off };
})();

/** Arms in clockwise order; the ring is rotated copies of the north-arm quarter. */
export const ARM_INDEX: Record<Approach, number> = { N: 0, E: 1, S: 2, W: 3 };
const ARMS_CW: Approach[] = ['N', 'E', 'S', 'W'];
export const rotCW = (p: Vec2, k: number): Vec2 => {
  let q = p;
  for (let i = 0; i < ((k % 4) + 4) % 4; i++) q = { x: q.y, y: -q.x };
  return q;
};
const mod = (a: number, n: number) => ((a % n) + n) % n;
const sample = (cx: number, cy: number, r: number, th0: number, th1: number, n: number): Vec2[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const th = th0 + ((th1 - th0) * i) / n;
    return { x: cx + r * Math.cos(th), y: cy + r * Math.sin(th) };
  });

function buildRing() {
  const { laneDist: D, cornerRadius: C, junctionRadius: rho, off } = RING;
  const quarter: Vec2[] = [{ x: -(D - C), y: D }, { x: D - C, y: D }, ...sample(D - C, D - C, C, Math.PI / 2, 0, 12).slice(1)];
  const points: Vec2[] = [];
  for (let k = 0; k < 4; k++) {
    const q = quarter.map((p) => rotCW(p, k));
    points.push(...(k === 0 ? q : q.slice(1)));
  }
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  const length = cum[cum.length - 1];
  const quarterLen = length / 4;
  const uMerge = {} as Record<Approach, number>;
  const uTurn = {} as Record<Approach, number>;
  ARMS_CW.forEach((arm, k) => {
    uMerge[arm] = k * quarterLen + (D - C) + (off + rho);
    uTurn[arm] = k * quarterLen + (D - C) - (off + rho);
  });
  // corner arcs in ring coordinates: from the end of the straight to the end of the quarter
  const corners: [number, number][] = ARMS_CW.map((_, k) => [k * quarterLen + 2 * (D - C), (k + 1) * quarterLen]);
  return { points, cum, length, quarterLen, uMerge, uTurn, corners };
}
export const RING_PATH = buildRing();

/** Position on the ring at coordinate u (metres, clockwise, wraps). */
export function ringPoseAt(u: number): Pose {
  const { points, cum, length } = RING_PATH;
  const x = mod(u, length);
  let lo = 0;
  let hi = points.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= x) lo = mid;
    else hi = mid - 1;
  }
  const a = points[lo];
  const b = points[lo + 1];
  const seg = cum[lo + 1] - cum[lo];
  const t = (x - cum[lo]) / seg;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, heading: Math.atan2(b.y - a.y, b.x - a.x) };
}

/** Polyline following the ring from u0 forward for `len` metres, endpoints included. */
function ringSlice(u0: number, len: number): Vec2[] {
  const { points, cum, length } = RING_PATH;
  const out: Vec2[] = [ringPoseAt(u0)];
  const start = mod(u0, length);
  const end = start + len;
  for (let lap = 0; lap < 2; lap++) {
    for (let i = 1; i < points.length - 1; i++) {
      const u = cum[i] + lap * length;
      if (u > start + 1e-9 && u < end - 1e-9) out.push(points[i]);
    }
  }
  out.push(ringPoseAt(end));
  return out;
}

function buildConnector(index: number, from: Approach, to: Approach): Route {
  const { laneDist: D, junctionRadius: rho, off, armLength: L } = RING;
  const kf = ARM_INDEX[from];
  const kt = ARM_INDEX[to];
  const exitArc = sample(off + rho, L, rho, Math.PI, Math.PI / 2, 10).map((p) => rotCW(p, kf));
  const turnIn = sample(-(off + rho), L, rho, Math.PI / 2, 0, 10).map((p) => rotCW(p, kt));
  const u0 = RING_PATH.uMerge[from];
  const ringLen = mod(RING_PATH.uTurn[to] - u0, RING_PATH.length);
  const slice = ringSlice(u0, ringLen);
  const pts = [...exitArc, ...slice.slice(1), ...turnIn.slice(1)];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const length = cum[cum.length - 1];
  const ringStartS = cum[exitArc.length - 1];
  const ringEndS = cum[exitArc.length - 1 + slice.length - 1];

  const limits: LimitSegment[] = [
    { s0: 0, s1: ringStartS, speed: 5 },
    { s0: ringEndS, s1: length, speed: 5 },
  ];
  for (const [ca, cb] of RING_PATH.corners) {
    for (const shift of [0, RING_PATH.length]) {
      const lo = Math.max(ca + shift, u0);
      const hi = Math.min(cb + shift, u0 + ringLen);
      if (hi > lo + 0.01) limits.push({ s0: ringStartS + lo - u0, s1: ringStartS + hi - u0, speed: 8 });
    }
  }
  limits.sort((a, b) => a.s0 - b.s0);
  void D;

  return {
    index,
    id: `C-${from}-${to}`,
    kind: 'connector',
    approach: to,
    movement: 'straight',
    exit: from,
    points: pts,
    cum,
    length,
    stopLineS: Infinity,
    boxEnterS: Infinity,
    boxExitS: -Infinity,
    turnSpeed: Infinity,
    limits,
    signals: [{ s0: 0, s1: ringStartS + 2, side: 'right' }, { s0: Math.max(ringEndS - 15, 0), s1: length, side: 'right' }],
    ringStartS,
    ringEndS,
  };
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
  for (const from of APPROACHES) for (const to of APPROACHES) routes.push(buildConnector(routes.length, from, to));
  const conflicts = routes.map((a) => routes.map((b) => (a.kind === 'main' && b.kind === 'main' ? classify(a, b) : ('none' as ConflictKind))));
  const lookup = new Map(routes.map((r) => [r.id, r]));
  return {
    routes,
    conflicts,
    route: (approach, movement) => lookup.get(`${approach}-${movement}`)!,
    connector: (from, to) => lookup.get(`C-${from}-${to}`)!,
  };
}

export const NETWORK: Network = buildNetwork();
