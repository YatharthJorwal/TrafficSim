import { Sky as DreiSky } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { merge } from './scenery/geom';
import { makeRng } from './scenery/rand';

export const SUN_DIRECTION = new THREE.Vector3(0.55, 0.7, 0.45).normalize();

function cloudGeometry(): THREE.BufferGeometry {
  const rng = makeRng(99);
  const parts: THREE.BufferGeometry[] = [];
  const blobs = 6;
  for (let i = 0; i < blobs; i++) {
    const g = new THREE.IcosahedronGeometry(rng.range(7, 12), 1);
    g.scale(1, 0.55, 0.9);
    g.translate((i - blobs / 2) * 8 + rng.range(-2, 2), rng.range(-1, 2.5), rng.range(-4, 4));
    const n = g.index ? g.toNonIndexed() : g;
    const col = new Float32Array(n.attributes.position.count * 3).fill(1);
    n.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(n);
  }
  return merge(parts);
}

/** Procedural sky plus a few low-poly clouds that drift slowly (purely cosmetic, real-time). */
export function SkyAndClouds() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(cloudGeometry, []);
  const clouds = useMemo(() => {
    const rng = makeRng(5);
    return Array.from({ length: 9 }, () => ({
      x: rng.range(-420, 420), y: rng.range(120, 190), z: rng.range(-420, 120),
      s: rng.range(0.9, 1.9), r: rng.range(0, Math.PI), v: rng.range(1.5, 3.5),
    }));
  }, []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const write = (t: number) => {
    const mesh = ref.current;
    if (!mesh) return;
    clouds.forEach((c, i) => {
      const x = ((c.x + c.v * t + 480) % 960) - 480;
      dummy.position.set(x, c.y, c.z);
      dummy.rotation.set(0, c.r, 0);
      dummy.scale.setScalar(c.s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  useLayoutEffect(() => write(0));
  useFrame((state) => write(state.clock.elapsedTime));

  return (
    <>
      <DreiSky distance={900} sunPosition={SUN_DIRECTION.toArray()} turbidity={3.5} rayleigh={1.1} mieCoefficient={0.004} mieDirectionalG={0.82} />
      <instancedMesh ref={ref} name="clouds" args={[geometry, undefined, 9]} frustumCulled={false}>
        <meshStandardMaterial vertexColors flatShading color="#ffffff" emissive="#ffffff" emissiveIntensity={0.35} roughness={1} fog={false} />
      </instancedMesh>
    </>
  );
}
