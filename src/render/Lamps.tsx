import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { box, cylinder, merge } from './scenery/geom';
import type { LampSpot } from './scenery/city';

function lampGeometry(): THREE.BufferGeometry {
  // arm extends along local +z, towards the road
  return merge([
    cylinder(0.07, 0.1, 6.6, 6, 0, 3.3, 0, '#58606b'),
    box(0.12, 0.12, 1.6, 0, 6.55, 0.75, '#58606b'),
    box(0.34, 0.1, 0.7, 0, 6.45, 1.55, '#e9e6d6'),
  ]);
}

export function Lamps({ spots }: { spots: LampSpot[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(lampGeometry, []);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const d = new THREE.Object3D();
    spots.forEach((s, i) => {
      d.position.set(s.x, 0.15, s.z);
      d.rotation.set(0, Math.atan2(Math.sin(s.yaw), Math.cos(s.yaw)), 0);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
    });
    mesh.count = spots.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [spots]);
  return (
    <instancedMesh ref={ref} name="lamps" args={[geometry, undefined, Math.max(1, spots.length)]} castShadow frustumCulled={false}>
      <meshStandardMaterial vertexColors roughness={0.7} />
    </instancedMesh>
  );
}
