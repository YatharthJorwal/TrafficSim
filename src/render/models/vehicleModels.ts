import * as THREE from 'three';
import { box, merge, paint } from '../scenery/geom';

export type VehicleType = 'sedan' | 'hatch' | 'suv' | 'van';
export const VEHICLE_TYPES: readonly VehicleType[] = ['sedan', 'hatch', 'suv', 'van'];

type P = [number, number];
interface Spec {
  length: number;
  width: number;
  /** Side profile as [fraction of length from the centre (-0.5..0.5), height]. Counter-clockwise. */
  profile: P[];
  /** Side window polygons, same units. */
  sideGlass: P[][];
  windshield: [P, P];
  rearGlass: [P, P] | null;
  wheelRadius: number;
  tailY: number;
}

const SPECS: Record<VehicleType, Spec> = {
  sedan: {
    length: 4.4, width: 1.8, wheelRadius: 0.33, tailY: 0.78,
    profile: [[-0.5, 0.3], [-0.5, 0.82], [-0.36, 0.93], [-0.24, 0.95], [-0.12, 1.4], [0.1, 1.42], [0.24, 0.98], [0.46, 0.8], [0.5, 0.7], [0.5, 0.3]],
    sideGlass: [[[-0.225, 0.99], [-0.115, 1.34], [0.085, 1.36], [0.2, 0.99]]],
    windshield: [[0.24, 0.98], [0.1, 1.42]], rearGlass: [[-0.24, 0.95], [-0.12, 1.4]],
  },
  hatch: {
    length: 3.9, width: 1.75, wheelRadius: 0.31, tailY: 0.82,
    profile: [[-0.5, 0.3], [-0.5, 0.98], [-0.39, 1.46], [0.08, 1.48], [0.24, 1.02], [0.46, 0.84], [0.5, 0.72], [0.5, 0.3]],
    sideGlass: [[[-0.36, 1.02], [-0.3, 1.4], [0.06, 1.42], [0.2, 1.02]]],
    windshield: [[0.24, 1.02], [0.08, 1.48]], rearGlass: [[-0.5, 0.98], [-0.39, 1.46]],
  },
  suv: {
    length: 4.4, width: 1.9, wheelRadius: 0.38, tailY: 0.95,
    profile: [[-0.5, 0.36], [-0.5, 1.15], [-0.45, 1.72], [0.06, 1.76], [0.2, 1.2], [0.46, 1.02], [0.5, 0.86], [0.5, 0.36]],
    sideGlass: [[[-0.42, 1.22], [-0.41, 1.66], [0.04, 1.7], [0.17, 1.22]]],
    windshield: [[0.2, 1.2], [0.06, 1.76]], rearGlass: [[-0.5, 1.15], [-0.45, 1.72]],
  },
  van: {
    length: 4.4, width: 1.9, wheelRadius: 0.36, tailY: 1.0,
    profile: [[-0.5, 0.34], [-0.5, 2.0], [-0.48, 2.06], [0.18, 2.06], [0.32, 1.12], [0.5, 0.96], [0.5, 0.34]],
    sideGlass: [[[0.19, 1.2], [0.22, 1.9], [0.0, 1.95], [-0.02, 1.2]]],
    windshield: [[0.32, 1.12], [0.18, 2.06]], rearGlass: null,
  },
};

const GLASS = '#1f2a35';
const TYRE = '#14161a';
const HUB = '#b8bdc4';
const HEADLIGHT = '#f6f1d6';
const TAIL = '#6e1818';
const TRIM = '#1c1e22';

export interface VehicleModel {
  type: VehicleType;
  length: number;
  width: number;
  /** Tinted per instance. */
  body: THREE.BufferGeometry;
  /** Windows, wheels, trim, lamps: fixed colours. */
  details: THREE.BufferGeometry;
  /** Rear brake-light pair, drawn only while braking. */
  brake: THREE.BufferGeometry;
  /** Left-side indicator pair; mirror with scale z = -1 for the right side. */
  blink: THREE.BufferGeometry;
}

export function buildVehicleModel(type: VehicleType): VehicleModel {
  const s = SPECS[type];
  const { length: L, width: W } = s;

  const shape = new THREE.Shape();
  s.profile.forEach(([fx, y], i) => (i === 0 ? shape.moveTo(fx * L, y) : shape.lineTo(fx * L, y)));
  shape.closePath();
  const body = new THREE.ExtrudeGeometry(shape, { depth: W, bevelEnabled: false });
  body.translate(0, 0, -W / 2);
  body.computeVertexNormals();

  const parts: THREE.BufferGeometry[] = [];
  // underbody and wheels
  parts.push(box(L * 0.96, 0.14, W * 0.94, 0, 0.3, 0, TRIM));
  for (const wx of [-0.31, 0.31]) {
    for (const side of [-1, 1]) {
      const wheel = new THREE.CylinderGeometry(s.wheelRadius, s.wheelRadius, 0.25, 12);
      wheel.rotateX(Math.PI / 2);
      wheel.translate(wx * L, s.wheelRadius, side * (W / 2 - 0.05));
      parts.push(paint(wheel, TYRE));
      const hub = new THREE.CylinderGeometry(s.wheelRadius * 0.55, s.wheelRadius * 0.55, 0.27, 8);
      hub.rotateX(Math.PI / 2);
      hub.translate(wx * L, s.wheelRadius, side * (W / 2 - 0.05));
      parts.push(paint(hub, HUB));
    }
  }
  // side glass: extruded slightly wider than the body so it shows on both flanks
  for (const poly of s.sideGlass) {
    const gs = new THREE.Shape();
    poly.forEach(([fx, y], i) => (i === 0 ? gs.moveTo(fx * L, y) : gs.lineTo(fx * L, y)));
    gs.closePath();
    const g = new THREE.ExtrudeGeometry(gs, { depth: W + 0.04, bevelEnabled: false });
    g.translate(0, 0, -(W + 0.04) / 2);
    parts.push(paint(g, GLASS));
  }
  const sloped = (a: P, b: P, outwardSign: 1 | -1) => {
    const ax = a[0] * L, bx = b[0] * L;
    const dx = bx - ax, dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    const g = new THREE.BoxGeometry(len * 0.9, 0.03, W - 0.26);
    g.rotateZ(Math.atan2(dy, dx));
    const nx = (outwardSign * dy) / len, ny = (-outwardSign * dx) / len;
    g.translate((ax + bx) / 2 + nx * 0.025, (a[1] + b[1]) / 2 + ny * 0.025, 0);
    return paint(g, GLASS);
  };
  parts.push(sloped(s.windshield[0], s.windshield[1], 1));
  if (s.rearGlass) parts.push(sloped(s.rearGlass[0], s.rearGlass[1], -1));
  // lamps and grille
  for (const side of [-1, 1]) {
    parts.push(box(0.06, 0.14, 0.34, L / 2 - 0.03, 0.66, side * (W / 2 - 0.3), HEADLIGHT));
    parts.push(box(0.06, 0.13, 0.36, -L / 2 + 0.03, s.tailY, side * (W / 2 - 0.3), TAIL));
  }
  parts.push(box(0.05, 0.2, W * 0.5, L / 2 - 0.025, 0.5, 0, TRIM));

  const brake = merge([-1, 1].map((side) => box(0.05, 0.13, 0.38, -L / 2 - 0.015, s.tailY, side * (W / 2 - 0.3), '#ffffff')));
  const blink = merge([
    box(0.05, 0.1, 0.2, L / 2 - 0.02, 0.66, -(W / 2 - 0.1), '#ffffff'),
    box(0.05, 0.1, 0.2, -L / 2 + 0.02, s.tailY - 0.1, -(W / 2 - 0.1), '#ffffff'),
  ]);

  return { type, length: L, width: W, body, details: merge(parts), brake, blink };
}

/** Stable visual type for a vehicle id: mostly sedans and hatchbacks, some SUVs and vans. */
export function vehicleTypeFor(id: number): VehicleType {
  const r = (Math.imul(id, 2654435761) >>> 0) % 100;
  return r < 45 ? 'sedan' : r < 70 ? 'hatch' : r < 90 ? 'suv' : 'van';
}

export const BODY_COLORS = ['#e8eaed', '#c4c9cf', '#2b2f36', '#1f3a5f', '#a32a2a', '#2f6b4f', '#8a7a66', '#d9c27a', '#5b6b7a', '#f0f0f0', '#7d1f2e'];
