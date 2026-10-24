import * as THREE from 'three';
import { BLOCK_SIZE, CROSSWALK_DIST, CROSSWALK_W, ROAD_HALF, ROAD_LENGTH, SIDEWALK_OUT, SIDEWALK_W } from '../../ambient/layout';
import { GEOMETRY } from '../../sim/network';
import { box, cylinder, ico, merge, onFace } from './geom';
import { makeRng, type Rng } from './rand';

export interface TreeSpot { x: number; z: number; scale: number; kind: 'round' | 'pine' }
export interface LampSpot { x: number; z: number; yaw: number }

export interface CityParts {
  /** Vertex-coloured solids: pavement, curbs, lawns, walls, roofs, awnings, furniture. */
  solid: THREE.BufferGeometry;
  /** Window glass (separate material). */
  glass: THREE.BufferGeometry;
  trees: TreeSpot[];
  lamps: LampSpot[];
  stats: { buildings: number; windows: number; parks: number; towers: number };
}

const WALLS = ['#cfc8bb', '#bdb5a8', '#aeb7c1', '#d6d9dc', '#a67a66', '#bb9680', '#97a2ae', '#c9b99a'];
const GLASS_TOWER = ['#8fa8bf', '#829db6', '#9db3c7'];
const WINDOWS = ['#2b3b4e', '#33485f', '#263340', '#3b5169', '#2f4257'];
const LIT = '#ecd9a0';
const ROOF = '#7a7f86';
const PARAPET = '#9aa0a7';
const AWNINGS = ['#c0493d', '#2f6f8f', '#d4a23c', '#4d8a5e', '#8a4f7d'];
const SIDEWALK = '#c7cacf';
const CURB = '#aeb2b9';
const PLAZA = '#d7d9d2';
const LAWN = '#8fb872';
const PATH = '#d9d2bf';

interface Ctx {
  solid: THREE.BufferGeometry[];
  glass: THREE.BufferGeometry[];
  trees: TreeSpot[];
  rng: Rng;
  stats: CityParts['stats'];
}
interface Face { nx: number; nz: number }
const FACES: Face[] = [{ nx: 1, nz: 0 }, { nx: -1, nz: 0 }, { nx: 0, nz: 1 }, { nx: 0, nz: -1 }];
const faceLen = (f: Face, w: number, d: number) => (f.nx !== 0 ? d : w);

function addWindows(c: Ctx, cx: number, cz: number, w: number, d: number, y0: number, floors: number, floorH: number, kind: 'punched' | 'ribbon', skipFirst: boolean) {
  for (const f of FACES) {
    const len = faceLen(f, w, d);
    for (let i = skipFirst ? 1 : 0; i < floors; i++) {
      const y = y0 + i * floorH + floorH * 0.58;
      if (kind === 'ribbon') {
        c.glass.push(onFace(box(len - 1.4, floorH * 0.5, 0.12, 0, y, 0.03, WINDOWS[(i + (f.nx + 2)) % WINDOWS.length]), f.nx, f.nz, cx, cz, w, d));
        c.stats.windows++;
        continue;
      }
      const cols = Math.max(1, Math.floor((len - 1.6) / 3.0));
      const step = (len - 1.6) / cols;
      for (let j = 0; j < cols; j++) {
        const tx = -len / 2 + 0.8 + (j + 0.5) * step;
        const color = c.rng.chance(0.09) ? LIT : c.rng.pick(WINDOWS);
        c.glass.push(onFace(box(1.3, 1.65, 0.14, tx, y, 0.03, color), f.nx, f.nz, cx, cz, w, d));
        c.stats.windows++;
      }
    }
  }
}

function addRoof(c: Ctx, cx: number, cz: number, w: number, d: number, h: number, antenna: boolean) {
  c.solid.push(box(w + 0.2, 0.3, d + 0.2, cx, h + 0.15, cz, ROOF));
  const t = 0.3;
  const ph = 0.55;
  c.solid.push(box(w + 0.2, ph, t, cx, h + 0.3 + ph / 2, cz + d / 2 - t / 2, PARAPET));
  c.solid.push(box(w + 0.2, ph, t, cx, h + 0.3 + ph / 2, cz - d / 2 + t / 2, PARAPET));
  c.solid.push(box(t, ph, d - 2 * t, cx + w / 2 - t / 2, h + 0.3 + ph / 2, cz, PARAPET));
  c.solid.push(box(t, ph, d - 2 * t, cx - w / 2 + t / 2, h + 0.3 + ph / 2, cz, PARAPET));
  const units = c.rng.int(1, 3);
  for (let i = 0; i < units; i++) {
    const ux = cx + c.rng.range(-w / 2 + 2, w / 2 - 2);
    const uz = cz + c.rng.range(-d / 2 + 2, d / 2 - 2);
    c.solid.push(box(c.rng.range(1.6, 2.6), 1.1, c.rng.range(1.2, 1.8), ux, h + 0.3 + 0.55, uz, '#b4b9bf'));
    c.solid.push(cylinder(0.45, 0.45, 0.18, 8, ux, h + 0.3 + 1.2, uz, '#6d737a'));
  }
  if (antenna) {
    c.solid.push(cylinder(0.08, 0.14, 7, 6, cx, h + 3.8, cz, '#aab0b7'));
    c.solid.push(ico(0.3, cx, h + 7.3, cz, '#d9534f'));
  } else if (c.rng.chance(0.35) && w > 10) {
    const tx = cx + w / 4;
    const tz = cz - d / 4;
    c.solid.push(cylinder(1.2, 1.2, 2.4, 8, tx, h + 0.3 + 1.9, tz, '#8a6a52'));
    c.solid.push(cylinder(0.05, 1.3, 0.9, 8, tx, h + 0.3 + 3.55, tz, '#6f5441'));
    for (const [lx, lz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) c.solid.push(box(0.15, 0.7, 0.15, tx + lx, h + 0.3 + 0.35, tz + lz, '#555a60'));
  }
}

function addStorefronts(c: Ctx, cx: number, cz: number, w: number, d: number, quad: { sx: number; sz: number }, awnings: boolean) {
  // Only the two faces that look onto a street get shop fronts.
  const streetFaces: Face[] = [{ nx: -quad.sx, nz: 0 }, { nx: 0, nz: -quad.sz }];
  for (const f of streetFaces) {
    const len = faceLen(f, w, d);
    c.solid.push(onFace(box(len - 1.0, 2.6, 0.2, 0, 1.55, 0.06, '#27414d'), f.nx, f.nz, cx, cz, w, d));
    c.solid.push(onFace(box(1.3, 2.3, 0.26, -len / 2 + 2.2, 1.2, 0.08, '#6c4a35'), f.nx, f.nz, cx, cz, w, d));
    if (!awnings) continue;
    const n = Math.max(2, Math.floor(len / 3.2));
    for (let i = 0; i < n; i++) {
      const g = new THREE.BoxGeometry(len / n - 0.15, 0.1, 1.5);
      g.rotateX(0.28);
      g.translate(-len / 2 + (i + 0.5) * (len / n), 3.35, 0.8);
      c.solid.push(onFace(coloured(g, AWNINGS[(i + c.stats.buildings) % AWNINGS.length]), f.nx, f.nz, cx, cz, w, d));
    }
  }
}

function coloured(g: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  const col = new THREE.Color(color);
  const arr = new Float32Array(out.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) {
    arr[i] = col.r;
    arr[i + 1] = col.g;
    arr[i + 2] = col.b;
  }
  out.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return out;
}

function tower(c: Ctx, cx: number, cz: number, w: number, d: number, h: number, quad: { sx: number; sz: number }) {
  const podiumH = 7;
  c.solid.push(box(w, podiumH, d, cx, podiumH / 2 + 0.1, cz, c.rng.pick(WALLS)));
  addWindows(c, cx, cz, w, d, 0.1 + 3.4, 1, 3.4, 'punched', false);
  addStorefronts(c, cx, cz, w, d, quad, true);
  c.solid.push(box(w + 0.3, 0.35, d + 0.3, cx, podiumH + 0.28, cz, PARAPET));

  const shaftW = w * 0.72;
  const shaftD = d * 0.72;
  const mid = h > 32 ? h * 0.72 : h;
  const color = c.rng.pick(GLASS_TOWER);
  const y0 = podiumH + 0.3;
  c.solid.push(box(shaftW, mid - y0, shaftD, cx, y0 + (mid - y0) / 2, cz, color));
  const floors = Math.floor((mid - y0) / 3.4);
  addWindows(c, cx, cz, shaftW, shaftD, y0, floors, 3.4, 'ribbon', false);
  let top = mid;
  if (h > 32) {
    const w2 = shaftW * 0.7;
    const d2 = shaftD * 0.7;
    c.solid.push(box(w2, h - mid, d2, cx, mid + (h - mid) / 2, cz, color));
    addWindows(c, cx, cz, w2, d2, mid, Math.floor((h - mid) / 3.4), 3.4, 'ribbon', false);
    top = h;
    addRoof(c, cx, cz, w2, d2, top, true);
  } else {
    addRoof(c, cx, cz, shaftW, shaftD, top, true);
  }
  c.stats.towers++;
}

function midrise(c: Ctx, cx: number, cz: number, w: number, d: number, h: number, quad: { sx: number; sz: number }) {
  const wall = c.rng.pick(WALLS);
  c.solid.push(box(w, h, d, cx, h / 2 + 0.1, cz, wall));
  const floors = Math.floor(h / 3.2);
  addWindows(c, cx, cz, w, d, 0.1, floors, 3.2, 'punched', true);
  addStorefronts(c, cx, cz, w, d, quad, c.rng.chance(0.6));
  // balcony slabs on the street-facing sides
  for (const f of [{ nx: -quad.sx, nz: 0 }, { nx: 0, nz: -quad.sz }]) {
    const len = faceLen(f, w, d);
    for (let i = 2; i < floors; i += 2) c.solid.push(onFace(box(len - 1.2, 0.14, 0.9, 0, 0.1 + i * 3.2 + 0.2, 0.45, '#b8bcc2'), f.nx, f.nz, cx, cz, w, d));
  }
  addRoof(c, cx, cz, w, d, h + 0.1, false);
}

function shops(c: Ctx, cx: number, cz: number, w: number, d: number, quad: { sx: number; sz: number }) {
  const h = c.rng.range(4.8, 7.2);
  const parts = c.rng.chance(0.5) && w > 12 ? 2 : 1;
  for (let i = 0; i < parts; i++) {
    const pw = w / parts;
    const px = cx - w / 2 + pw * (i + 0.5);
    const hh = h + (i % 2) * c.rng.range(-0.8, 1.2);
    c.solid.push(box(pw - 0.15, hh, d, px, hh / 2 + 0.1, cz, c.rng.pick(WALLS)));
    addWindows(c, px, cz, pw - 0.15, d, 3.6, 1, 3.4, 'punched', false);
    addStorefronts(c, px, cz, pw - 0.15, d, quad, true);
    addRoof(c, px, cz, pw - 0.15, d, hh + 0.1, false);
    c.stats.buildings += i > 0 ? 1 : 0;
  }
}

function park(c: Ctx, cx: number, cz: number, w: number, d: number) {
  c.solid.push(box(w, 0.16, d, cx, 0.08 + 0.02, cz, LAWN));
  c.solid.push(box(1.8, 0.19, d - 1.2, cx, 0.095 + 0.02, cz, PATH));
  c.solid.push(box(w - 1.2, 0.19, 1.8, cx, 0.095 + 0.02, cz, PATH));
  c.solid.push(cylinder(2.6, 2.6, 0.5, 14, cx, 0.35, cz, '#b9bcc0'));
  c.solid.push(cylinder(2.2, 2.2, 0.46, 14, cx, 0.4, cz, '#6fb3d9'));
  c.solid.push(cylinder(0.3, 0.45, 1.5, 8, cx, 1.0, cz, '#b9bcc0'));
  for (const [bx, bz] of [[3.2, 1.4], [-3.2, -1.4], [1.4, -3.2], [-1.4, 3.2]]) {
    c.solid.push(box(1.6, 0.12, 0.5, cx + bx, 0.55, cz + bz, '#8a6a4b'));
    c.solid.push(box(1.6, 0.4, 0.1, cx + bx, 0.8, cz + bz - 0.22, '#8a6a4b'));
  }
  let n = c.rng.int(7, 10);
  let guard = 0;
  while (n > 0 && guard++ < 100) {
    const x = cx + c.rng.range(-w / 2 + 1.5, w / 2 - 1.5);
    const z = cz + c.rng.range(-d / 2 + 1.5, d / 2 - 1.5);
    if (Math.abs(x - cx) < 2.2 || Math.abs(z - cz) < 2.2 || Math.hypot(x - cx, z - cz) < 4.5) continue;
    c.trees.push({ x, z, scale: c.rng.range(0.9, 1.4), kind: c.rng.chance(0.7) ? 'round' : 'pine' });
    n--;
  }
  c.stats.parks++;
}

interface Lot { u0: number; u1: number; v0: number; v1: number }

function splitBlock(rng: Rng): Lot[] {
  const cols = rng.chance(0.4) ? [0, rng.range(13, 17), rng.range(28, 32), BLOCK_SIZE] : [0, rng.range(18, 27), BLOCK_SIZE];
  const lots: Lot[] = [];
  for (let i = 0; i + 1 < cols.length; i++) {
    const rows = rng.chance(0.65) ? [0, rng.range(18, 27), BLOCK_SIZE] : [0, BLOCK_SIZE];
    for (let j = 0; j + 1 < rows.length; j++) lots.push({ u0: cols[i], u1: cols[i + 1], v0: rows[j], v1: rows[j + 1] });
  }
  return lots;
}

function pavement(c: Ctx) {
  const len = ROAD_LENGTH - ROAD_HALF;
  const lenB = ROAD_LENGTH - SIDEWALK_OUT;
  const cwLo = CROSSWALK_DIST - CROSSWALK_W / 2;
  const cwHi = CROSSWALK_DIST + CROSSWALK_W / 2;
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      c.solid.push(box(SIDEWALK_W, 0.15, len, sx * (ROAD_HALF + SIDEWALK_W / 2), 0.075, sz * (ROAD_HALF + len / 2), SIDEWALK));
      c.solid.push(box(lenB, 0.15, SIDEWALK_W, sx * (SIDEWALK_OUT + lenB / 2), 0.075, sz * (ROAD_HALF + SIDEWALK_W / 2), SIDEWALK));
      // Curb lips, interrupted where the crosswalks cross them.
      const segs: [number, number][] = [[ROAD_HALF, cwLo], [cwHi, ROAD_LENGTH]];
      for (const [a, b] of segs) {
        c.solid.push(box(0.25, 0.19, b - a, sx * (ROAD_HALF + 0.125), 0.095, sz * ((a + b) / 2), CURB));
        c.solid.push(box(b - a, 0.19, 0.25, sx * ((a + b) / 2), 0.095, sz * (ROAD_HALF + 0.125), CURB));
      }
      c.solid.push(box(BLOCK_SIZE, 0.1, BLOCK_SIZE, sx * (SIDEWALK_OUT + BLOCK_SIZE / 2), 0.05, sz * (SIDEWALK_OUT + BLOCK_SIZE / 2), PLAZA));
    }
  }
}

export function buildCity(seed = 7): CityParts {
  const rng = makeRng(seed);
  const c: Ctx = { solid: [], glass: [], trees: [], rng, stats: { buildings: 0, windows: 0, parks: 0, towers: 0 } };
  pavement(c);

  const quads = [{ sx: 1, sz: 1 }, { sx: -1, sz: 1 }, { sx: -1, sz: -1 }, { sx: 1, sz: -1 }];
  let parkMade = false;
  quads.forEach((quad, qi) => {
    const lots = splitBlock(rng);
    lots.forEach((lot, li) => {
      const gap = 1.3;
      const u0 = lot.u0 + gap;
      const u1 = lot.u1 - gap;
      const v0 = lot.v0 + gap;
      const v1 = lot.v1 - gap;
      const w = u1 - u0;
      const d = v1 - v0;
      const cx = quad.sx * (SIDEWALK_OUT + (u0 + u1) / 2);
      const cz = quad.sz * (SIDEWALK_OUT + (v0 + v1) / 2);
      const wantPark = !parkMade && qi === 3 && li === 0 && w > 14 && d > 14;
      if (wantPark) {
        park(c, cx, cz, w, d);
        parkMade = true;
        return;
      }
      const area = w * d;
      const roll = rng.next();
      // The lot touching the intersection corner stays low so the junction is always visible.
      if (lot.u0 === 0 && lot.v0 === 0) {
        if (roll < 0.5) shops(c, cx, cz, w, d, quad);
        else midrise(c, cx, cz, w, d, rng.range(9, 13), quad);
      } else if (area < 170 || roll < 0.18) shops(c, cx, cz, w, d, quad);
      else if (roll < 0.58 && w > 12 && d > 12) tower(c, cx, cz, w, d, rng.range(22, 44), quad);
      else midrise(c, cx, cz, w, d, rng.range(10, 20), quad);
      c.stats.buildings++;
    });
  });
  if (!parkMade) park(c, quads[3].sx * (SIDEWALK_OUT + 22), quads[3].sz * (SIDEWALK_OUT + 22), 30, 30);

  // Lamps and street trees along the four arms, alternating sides.
  const lamps: LampSpot[] = [];
  const trees = c.trees;
  const armDirs = [{ x: 0, z: -1 }, { x: 0, z: 1 }, { x: 1, z: 0 }, { x: -1, z: 0 }];
  for (const a of armDirs) {
    const perp = { x: Math.abs(a.z), z: Math.abs(a.x) };
    let i = 0;
    for (let dist = GEOMETRY.stopLineDist + 8; dist < ROAD_LENGTH - 4; dist += 14, i++) {
      for (const side of [1, -1]) {
        const lateral = side * (SIDEWALK_OUT - 0.6);
        const x = a.x * dist + perp.x * lateral;
        const z = a.z * dist + perp.z * lateral;
        if (((i + (side > 0 ? 0 : 1)) & 1) === 0) lamps.push({ x, z, yaw: Math.atan2(-perp.x * side, -perp.z * side) });
        else if (dist > 30) trees.push({ x, z, scale: rng.range(0.7, 0.95), kind: 'round' });
      }
    }
  }
  for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) lamps.push({ x: sx * (SIDEWALK_OUT - 0.7), z: sz * (SIDEWALK_OUT - 0.7), yaw: Math.atan2(-sx, -sz) });

  return { solid: merge(c.solid), glass: merge(c.glass), trees, lamps, stats: c.stats };
}
