import * as THREE from 'three';
import { ROAD_LENGTH } from '../../ambient/layout';
import { makeRng } from './rand';
import type { TreeSpot } from './city';

/** Terrain is dead flat out to this radius so roads, blocks and arms never touch a hill. */
export const FLAT_RADIUS = ROAD_LENGTH + 30;
const SIZE = 760;
const SEGMENTS = 120;

function hash(ix: number, iz: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function smooth(t: number) {
  return t * t * (3 - 2 * t);
}
function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
function fbm(x: number, z: number): number {
  return valueNoise(x, z) * 0.6 + valueNoise(x * 2.1, z * 2.1) * 0.28 + valueNoise(x * 4.3, z * 4.3) * 0.12;
}

/** Ground height at world (x, z): 0 inside FLAT_RADIUS, rolling low-poly hills outside. */
export function terrainHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  if (r <= FLAT_RADIUS) return 0;
  const ramp = smooth(Math.min(1, (r - FLAT_RADIUS) / 110));
  return ramp * (4 + fbm(x / 55, z / 55) * 42);
}

const GRASS = [new THREE.Color('#9dbf7e'), new THREE.Color('#8fb472'), new THREE.Color('#a6c487')];
const HILL = [new THREE.Color('#6f9a5e'), new THREE.Color('#628b55')];
const ROCK = new THREE.Color('#8d9484');

export function buildTerrain(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  const p = flat.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let tri = 0; tri < p.count; tri += 3) {
    // one colour per triangle gives the faceted low-poly look
    const cx = (p.getX(tri) + p.getX(tri + 1) + p.getX(tri + 2)) / 3;
    const cz = (p.getZ(tri) + p.getZ(tri + 1) + p.getZ(tri + 2)) / 3;
    const cy = (p.getY(tri) + p.getY(tri + 1) + p.getY(tri + 2)) / 3;
    const n = hash(Math.floor(cx * 3.1), Math.floor(cz * 3.1));
    if (cy < 0.01) c.copy(GRASS[Math.floor(n * GRASS.length)]);
    else if (cy < 30) c.copy(HILL[Math.floor(n * HILL.length)]).lerp(GRASS[0], Math.max(0, 1 - cy / 14) * 0.6);
    else c.copy(HILL[0]).lerp(ROCK, Math.min(1, (cy - 30) / 14));
    c.multiplyScalar(0.93 + n * 0.14);
    for (let k = 0; k < 3; k++) {
      colors[(tri + k) * 3] = c.r;
      colors[(tri + k) * 3 + 1] = c.g;
      colors[(tri + k) * 3 + 2] = c.b;
    }
  }
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return flat;
}

/** Trees on the surrounding land, clear of the city, the roads and their verges. */
export function scatterOutskirtTrees(count = 360, seed = 31): TreeSpot[] {
  const rng = makeRng(seed);
  const out: TreeSpot[] = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 30) {
    const ang = rng.range(0, Math.PI * 2);
    const r = rng.range(40, 330);
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    if (Math.abs(x) < 56 && Math.abs(z) < 56) continue; // the city
    if (r < FLAT_RADIUS && (Math.abs(x) < 14 || Math.abs(z) < 14)) continue; // roads and verges
    if (terrainHeight(x, z) > 38) continue;
    out.push({ x, z, scale: rng.range(0.8, 1.7), kind: rng.chance(0.45) ? 'pine' : 'round' });
  }
  return out;
}
