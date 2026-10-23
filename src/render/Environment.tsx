import { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { GEOMETRY } from '../sim/network';
import { ROAD_HALF } from './coords';

const ARM = GEOMETRY.armLength;
const BLOCK_EDGE = ROAD_HALF + 1.5; // sidewalk starts just outside the road
const BLOCK_SIZE = 45;

interface Building { x: number; z: number; w: number; d: number; h: number }
/** Fixed layout (no randomness) for one quadrant. */
const LAYOUT: Building[] = [
  { x: 9, z: 9, w: 14, d: 14, h: 14 },
  { x: 29, z: 8, w: 16, d: 11, h: 24 },
  { x: 8, z: 29, w: 11, d: 16, h: 9 },
  { x: 30, z: 30, w: 15, d: 15, h: 18 },
];
const TINTS = ['#aeb8c4', '#b9bfc7', '#a3aebb', '#c3c7cc'];
const QUADRANTS: { sx: number; sz: number; k: number }[] = [
  { sx: 1, sz: 1, k: 1 },
  { sx: -1, sz: 1, k: 0.85 },
  { sx: -1, sz: -1, k: 1.15 },
  { sx: 1, sz: -1, k: 0.95 },
];

function Block({ sx, sz, k }: { sx: number; sz: number; k: number }) {
  const cx = sx * (BLOCK_EDGE + BLOCK_SIZE / 2);
  const cz = sz * (BLOCK_EDGE + BLOCK_SIZE / 2);
  return (
    <group>
      <mesh position={[cx, 0.08, cz]}>
        <boxGeometry args={[BLOCK_SIZE, 0.16, BLOCK_SIZE]} />
        <meshStandardMaterial color="#d6d9dd" />
      </mesh>
      {LAYOUT.map((b, i) => {
        // b.x / b.z are measured outward from the block corner nearest the intersection.
        const h = b.h * k;
        const x = sx * (BLOCK_EDGE + b.x + b.w / 2);
        const z = sz * (BLOCK_EDGE + b.z + b.d / 2);
        return (
          <mesh key={i} position={[x, 0.16 + h / 2, z]}>
            <boxGeometry args={[b.w, h, b.d]} />
            <meshStandardMaterial color={TINTS[i % TINTS.length]} />
          </mesh>
        );
      })}
    </group>
  );
}

function CentreDashes() {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const d = new THREE.Object3D();
    let i = 0;
    for (const dir of [1, -1]) {
      for (let p = GEOMETRY.stopLineDist + 3; p < ARM - 2; p += 6) {
        d.rotation.set(-Math.PI / 2, 0, 0);
        d.scale.set(0.18, 2.2, 1);
        d.position.set(0, 0.05, dir * (p + 1.1)); // along the N-S road
        d.updateMatrix();
        mesh.setMatrixAt(i++, d.matrix);
        d.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
        d.position.set(dir * (p + 1.1), 0.05, 0); // along the E-W road
        d.updateMatrix();
        mesh.setMatrixAt(i++, d.matrix);
      }
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
  }, []);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, 128]} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
      <meshStandardMaterial color="#e8e6dc" />
    </instancedMesh>
  );
}

/** Static scenery: ground, the two roads, centre markings and four city blocks. */
export function Environment() {
  const len = ARM * 2 + 8;
  return (
    <group name="environment">
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]}>
        <planeGeometry args={[600, 600]} />
        <meshStandardMaterial color="#c8cfc6" />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]}>
        <planeGeometry args={[ROAD_HALF * 2, len]} />
        <meshStandardMaterial color="#3a3f47" />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.021, 0]}>
        <planeGeometry args={[len, ROAD_HALF * 2]} />
        <meshStandardMaterial color="#3a3f47" />
      </mesh>
      <CentreDashes />
      {QUADRANTS.map((q, i) => (
        <Block key={i} {...q} />
      ))}
    </group>
  );
}
