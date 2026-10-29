import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { RING_ROAD_WIDTH, RING_WALL_OFFSET } from '../../ambient/layout';
import { RING, RING_PATH, ringPoseAt } from '../../sim/network';
import { buildRingRoad, ribbon, ringSamples } from './ring';

function verts(g: THREE.BufferGeometry): [number, number, number][] {
  const p = g.attributes.position;
  return Array.from({ length: p.count }, (_, i) => [p.getX(i), p.getY(i), p.getZ(i)]);
}
/** Distance from a world point to the ring lane centreline. */
const ringDistance = (x: number, z: number, samples = ringSamples(0, RING_PATH.length, 1)) => Math.min(...samples.map((p) => Math.hypot(p.x - x, p.y + z)));

describe('ribbon', () => {
  it('lies flat, faces up and has the requested width', () => {
    const g = ribbon([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }], 4, 0.1);
    const v = verts(g);
    expect(v.every(([, y]) => Math.abs(y - 0.1) < 1e-6)).toBe(true);
    expect(Math.max(...v.map(([, , z]) => z)) - Math.min(...v.map(([, , z]) => z))).toBeCloseTo(4, 9);
    const idx = g.index!.array;
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => new THREE.Vector3(...v[idx[t + k]]));
      expect(new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).y).toBeGreaterThan(0);
    }
  });
});

describe('ring road scenery', () => {
  const ring = buildRingRoad();
  const samples = ringSamples(0, RING_PATH.length, 1);

  it('puts asphalt along the whole ring, flat on the ground', () => {
    const v = verts(ring.asphalt);
    expect(v.every(([, y]) => y > 0.015 && y < 0.03)).toBe(true);
    for (let u = 0; u < RING_PATH.length; u += 25) {
      const p = ringPoseAt(u);
      expect(v.some(([x, , z]) => Math.hypot(x - p.x, z + p.y) < RING_ROAD_WIDTH)).toBe(true);
    }
    for (const [x, , z] of v) expect(Math.max(Math.abs(x), Math.abs(z))).toBeLessThanOrEqual(RING.laneDist + RING_ROAD_WIDTH / 2 + 0.01);
  });

  it('connects every arm to the ring with slip roads on both sides', () => {
    const v = verts(ring.asphalt);
    // north arm: asphalt in the corner between the arm road and the ring, either side of it
    expect(v.some(([x, , z]) => x > 4 && x < 8 && -z > 100 && -z < 103.5)).toBe(true);
    expect(v.some(([x, , z]) => x < -4 && x > -8 && -z > 100 && -z < 103.5)).toBe(true);
    // and the same on the east arm (rotated)
    expect(v.some(([x, , z]) => x > 100 && x < 103.5 && -z > 4 && -z < 8)).toBe(true);
  });

  it('draws edge lines that stop for the slip roads on the inside only', () => {
    const v = verts(ring.lines);
    const nearJunction = (x: number, z: number) => Math.abs(x) < 7 && -z > 101 && -z < 105.5; // inner line at the north arm
    expect(v.some(([x, , z]) => nearJunction(x, z))).toBe(false);
    expect(v.some(([x, , z]) => Math.abs(x) < 7 && -z > 107.5 && -z < 109)).toBe(true); // outer line is unbroken
    expect(v.some(([x, , z]) => x > 20 && x < 60 && -z > 101 && -z < 105.5)).toBe(true); // inner line elsewhere
  });

  it('builds a low perimeter wall just outside the ring', () => {
    const v = verts(ring.wall);
    expect(v.length).toBeGreaterThan(1000);
    expect(Math.max(...v.map(([, y]) => y))).toBeLessThan(1);
    for (let i = 0; i < v.length; i += 37) {
      const d = ringDistance(v[i][0], v[i][2], samples);
      expect(d).toBeGreaterThan(RING_WALL_OFFSET - 0.8);
      expect(d).toBeLessThan(RING_WALL_OFFSET + 0.8);
    }
  });

  it('marks the direction of travel with chevrons that follow the ring, clear of the junctions', () => {
    expect(ring.arrows.length).toBeGreaterThan(15);
    for (const a of ring.arrows) {
      expect(ringDistance(a.x, -a.y, samples)).toBeLessThan(0.5);
    }
    const top = ring.arrows.filter((a) => a.y > 100 && Math.abs(a.x) < 60);
    expect(top.length).toBeGreaterThan(0);
    for (const a of top) expect(Math.abs(Math.sin(a.heading))).toBeLessThan(0.01); // heading east: clockwise
    expect(ring.arrows.some((a) => a.y > 100 && Math.abs(a.x) < 10)).toBe(false); // none inside the north junction
  });
});
