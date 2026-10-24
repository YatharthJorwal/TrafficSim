import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { cylinder, ico, merge } from './scenery/geom';
import { terrainHeight } from './scenery/terrain';
import type { TreeSpot } from './scenery/city';

function roundTree(): THREE.BufferGeometry {
  return merge([
    cylinder(0.2, 0.28, 2.4, 6, 0, 1.2, 0, '#6b4a32'),
    ico(1.9, 0, 3.7, 0, '#5f9b57', 0.9),
    ico(1.35, 0.8, 4.6, 0.3, '#6aa862', 0.9),
    ico(1.2, -0.7, 4.3, -0.5, '#58914f', 0.9),
  ]);
}
function pineTree(): THREE.BufferGeometry {
  return merge([
    cylinder(0.18, 0.24, 1.8, 6, 0, 0.9, 0, '#6b4a32'),
    cylinder(0, 1.7, 2.8, 7, 0, 2.9, 0, '#3f7a4f'),
    cylinder(0, 1.35, 2.4, 7, 0, 4.3, 0, '#47865a'),
    cylinder(0, 0.9, 2.1, 7, 0, 5.6, 0, '#4f9163'),
  ]);
}

function Species({ geometry, spots, name }: { geometry: THREE.BufferGeometry; spots: TreeSpot[]; name: string }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const d = new THREE.Object3D();
    const c = new THREE.Color();
    spots.forEach((s, i) => {
      const h = Math.abs(Math.sin(s.x * 12.9898 + s.z * 78.233));
      d.position.set(s.x, terrainHeight(s.x, s.z), s.z);
      d.rotation.set(0, h * 6.28, 0);
      d.scale.setScalar(s.scale);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
      c.setScalar(0.86 + h * 0.28);
      mesh.setColorAt(i, c);
    });
    mesh.count = spots.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [spots]);
  return (
    <instancedMesh ref={ref} name={name} args={[geometry, undefined, Math.max(1, spots.length)]} castShadow frustumCulled={false}>
      <meshStandardMaterial vertexColors flatShading roughness={0.95} />
    </instancedMesh>
  );
}

export function Trees({ spots }: { spots: TreeSpot[] }) {
  const round = useMemo(roundTree, []);
  const pine = useMemo(pineTree, []);
  const rounds = useMemo(() => spots.filter((s) => s.kind === 'round'), [spots]);
  const pines = useMemo(() => spots.filter((s) => s.kind === 'pine'), [spots]);
  return (
    <group name="trees">
      <Species geometry={round} spots={rounds} name="trees-round" />
      <Species geometry={pine} spots={pines} name="trees-pine" />
    </group>
  );
}
