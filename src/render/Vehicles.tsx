import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { FixedStepLoop } from '../runtime';
import { interpolateVehicles } from '../runtime';

const MAX_VEHICLES = 600;
const BODY_H = 0.8;
const CABIN_H = 0.55;
const PALETTE = ['#e5e7eb', '#94a3b8', '#5b8def', '#e2655b', '#e6b94d', '#4fb58a', '#475569', '#a07be0'];

/** All vehicles as two instanced meshes (body + cabin). Poses are interpolated between fixed steps. */
export function Vehicles({ loop }: { loop: FixedStepLoop }) {
  const body = useRef<THREE.InstancedMesh>(null);
  const cabin = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const { length, width } = loop.runner.engine.config.vehicle;

  useFrame(() => {
    const b = body.current;
    const c = cabin.current;
    if (!b || !c) return;
    const list = interpolateVehicles(loop.prev, loop.curr, loop.alpha, length);
    const n = Math.min(list.length, MAX_VEHICLES);
    for (let i = 0; i < n; i++) {
      const v = list[i];
      const cos = Math.cos(v.heading);
      const sin = Math.sin(v.heading);

      dummy.rotation.set(0, v.heading, 0);
      dummy.position.set(v.x, 0.3 + BODY_H / 2, -v.y);
      dummy.scale.set(length, BODY_H, width);
      dummy.updateMatrix();
      b.setMatrixAt(i, dummy.matrix);

      // Cabin sits slightly behind the middle (forward direction in world is (cos, 0, -sin)).
      dummy.position.set(v.x - cos * 0.35, 0.3 + BODY_H + CABIN_H / 2, -v.y + sin * 0.35);
      dummy.scale.set(length * 0.52, CABIN_H, width * 0.88);
      dummy.updateMatrix();
      c.setMatrixAt(i, dummy.matrix);

      color.set(PALETTE[v.id % PALETTE.length]);
      b.setColorAt(i, color);
      color.multiplyScalar(0.6);
      c.setColorAt(i, color);
    }
    b.count = n;
    c.count = n;
    b.instanceMatrix.needsUpdate = true;
    c.instanceMatrix.needsUpdate = true;
    if (b.instanceColor) b.instanceColor.needsUpdate = true;
    if (c.instanceColor) c.instanceColor.needsUpdate = true;
  });

  return (
    <group name="vehicles">
      <instancedMesh ref={body} name="vehicle-bodies" args={[undefined, undefined, MAX_VEHICLES]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.6} />
      </instancedMesh>
      <instancedMesh ref={cabin} name="vehicle-cabins" args={[undefined, undefined, MAX_VEHICLES]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.5} />
      </instancedMesh>
    </group>
  );
}
