import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Give a primitive flat vertex colours and make it non-indexed so all parts can be merged. */
export function paint(g: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(color);
  const n = out.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  out.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return out;
}

export function box(w: number, h: number, d: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, ry = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return paint(g, color);
}

export function cylinder(rTop: number, rBottom: number, h: number, seg: number, x: number, y: number, z: number, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg);
  g.translate(x, y, z);
  return paint(g, color);
}

export function ico(r: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, sy = 1): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, 0);
  g.scale(1, sy, 1);
  g.translate(x, y, z);
  return paint(g, color);
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (parts.length === 0) return new THREE.BufferGeometry();
  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Place a part built in "face space" (+z = outward normal, +x = along the face) onto a building face. */
export function onFace(g: THREE.BufferGeometry, nx: number, nz: number, cx: number, cz: number, w: number, d: number): THREE.BufferGeometry {
  g.rotateY(Math.atan2(nx, nz));
  g.translate(cx + nx * (w / 2), 0, cz + nz * (d / 2));
  return g;
}
