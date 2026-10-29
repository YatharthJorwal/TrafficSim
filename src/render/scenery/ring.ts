import * as THREE from 'three';
import { RING_ROAD_WIDTH, RING_WALL_OFFSET } from '../../ambient/layout';
import { ARM_INDEX, NETWORK, RING, RING_PATH, ringPoseAt, rotCW } from '../../sim/network';
import { APPROACHES, type Vec2 } from '../../sim/types';
import { box, merge } from './geom';

/** Flat strip along a polyline (sim coordinates), lying on the ground at height y. Indexed, position + normal only. */
export function ribbon(points: Vec2[], width: number, y: number): THREE.BufferGeometry {
  const n = points.length;
  const pos = new Float32Array(n * 2 * 3);
  const nor = new Float32Array(n * 2 * 3);
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const tx = (b.x - a.x) / len;
    const ty = (b.y - a.y) / len;
    const nx = -ty; // left of the direction of travel
    const ny = tx;
    const p = points[i];
    const set = (k: number, sx: number, sy: number) => {
      pos[k * 3] = sx;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = -sy; // sim y (north) is world -z
      nor[k * 3 + 1] = 1;
    };
    set(2 * i, p.x + (nx * width) / 2, p.y + (ny * width) / 2);
    set(2 * i + 1, p.x - (nx * width) / 2, p.y - (ny * width) / 2);
  }
  const idx: number[] = [];
  for (let i = 0; i + 1 < n; i++) {
    const l0 = 2 * i, r0 = 2 * i + 1, l1 = 2 * i + 2, r1 = 2 * i + 3;
    idx.push(l0, r0, l1, r0, r1, l1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/** Points of the ring from u0 to u1 (clockwise, wraps), every `step` metres. */
export function ringSamples(u0: number, u1: number, step = 1): Vec2[] {
  const out: Vec2[] = [];
  const n = Math.max(1, Math.ceil((u1 - u0) / step));
  for (let i = 0; i <= n; i++) {
    const p = ringPoseAt(u0 + ((u1 - u0) * i) / n);
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

/** The ring lane's centreline shifted `d` metres outward (negative = inward). */
function ringOffset(u0: number, u1: number, d: number, step = 1): Vec2[] {
  const out: Vec2[] = [];
  const n = Math.max(1, Math.ceil((u1 - u0) / step));
  for (let i = 0; i <= n; i++) {
    const p = ringPoseAt(u0 + ((u1 - u0) * i) / n);
    out.push({ x: p.x - Math.sin(p.heading) * d, y: p.y + Math.cos(p.heading) * d });
  }
  return out;
}

export interface RingRoadParts {
  asphalt: THREE.BufferGeometry;
  /** White edge lines. */
  lines: THREE.BufferGeometry;
  /** Perimeter wall (vertex coloured). */
  wall: THREE.BufferGeometry;
  /** Clockwise chevrons: ring coordinate and heading for each. */
  arrows: { x: number; y: number; heading: number }[];
}

/** Gaps in the inner edge line where the slip roads join, as [uStart, uEnd] intervals in order around the loop. */
function junctionGaps(): [number, number][] {
  return APPROACHES.map((a) => [RING_PATH.uTurn[a] - 3, RING_PATH.uMerge[a] + 3] as [number, number]).sort((a, b) => a[0] - b[0]);
}

export function buildRingRoad(): RingRoadParts {
  const P = RING_PATH.length;
  const half = RING_ROAD_WIDTH / 2;

  const asphalt: THREE.BufferGeometry[] = [ribbon(ringSamples(0, P, 1), RING_ROAD_WIDTH, 0.021)];
  // slip roads: the exit arc and entry arc of every arm, taken from its own connectors
  for (const a of APPROACHES) {
    const c = NETWORK.connector(a, a);
    const exitArc: Vec2[] = [];
    const entryArc: Vec2[] = [];
    c.points.forEach((p, i) => {
      if (c.cum[i] <= c.ringStartS + 1e-6) exitArc.push(p);
      if (c.cum[i] >= c.ringEndS - 1e-6) entryArc.push(p);
    });
    asphalt.push(ribbon(exitArc, 4.6, 0.022), ribbon(entryArc, 4.6, 0.022));
    // fill the corner between the arm road's edge and the ring's inner edge on both sides of the arm
    const k = ARM_INDEX[a];
    for (const side of [1, -1]) {
      const centre = rotCW({ x: side * 6.25, y: RING.armLength + 1.75 }, k);
      const w = k % 2 === 0 ? 5.5 : 3.5;
      const d = k % 2 === 0 ? 3.5 : 5.5;
      asphalt.push(flatBox(centre.x, centre.y, w, d, 0.022));
    }
  }

  // Edge lines: continuous on the outside, broken at the slip roads on the inside.
  const lines: THREE.BufferGeometry[] = [ribbon(ringOffset(0, P, half - 0.3, 1.5), 0.15, 0.04)];
  const gaps = junctionGaps();
  let from = gaps[gaps.length - 1][1] - P;
  for (const [g0, g1] of gaps) {
    if (g0 > from + 1) lines.push(ribbon(ringOffset(from, g0, -(half - 0.3), 1.5), 0.15, 0.04));
    from = g1;
  }
  lines.push(ribbon(ringOffset(from, gaps[0][0] + P, -(half - 0.3), 1.5), 0.15, 0.04));

  // Perimeter wall: short boxes following the outside of the ring.
  const wall: THREE.BufferGeometry[] = [];
  const step = 2;
  for (let u = 0; u < P; u += step) {
    const a = ringOffset(u, u + step, RING_WALL_OFFSET, step);
    const [p0, p1] = [a[0], a[a.length - 1]];
    const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    wall.push(box(len + 0.1, 0.9, 0.5, (p0.x + p1.x) / 2, 0.45, -(p0.y + p1.y) / 2, '#bdbfc3', ang));
  }

  // Chevrons pointing the way round, clear of the junctions.
  const arrows: RingRoadParts['arrows'] = [];
  for (let u = 20; u < P; u += 36) {
    if (gaps.some(([g0, g1]) => (u > g0 - 6 && u < g1 + 6) || (u + P > g0 - 6 && u + P < g1 + 6))) continue;
    const p = ringPoseAt(u);
    arrows.push({ x: p.x, y: p.y, heading: p.heading });
  }

  return { asphalt: merge(asphalt), lines: merge(lines), wall: merge(wall), arrows };
}

function flatBox(cx: number, cy: number, w: number, d: number, y: number): THREE.BufferGeometry {
  const hw = w / 2;
  const hd = d / 2;
  const pts = [
    [cx - hw, cy + hd], [cx + hw, cy + hd], [cx - hw, cy - hd], [cx + hw, cy - hd],
  ];
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(pts.flatMap(([x, yy]) => [x, y, -yy]));
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
  // corners: 0 NW, 1 NE, 2 SW, 3 SE (sim). Counter-clockwise seen from above (+y).
  g.setIndex([0, 2, 1, 1, 2, 3]);
  return g;
}
