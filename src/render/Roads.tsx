import { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { ARM_END, CROSSWALK_DIST, CROSSWALK_W, ROAD_HALF, ROAD_LENGTH } from '../ambient/layout';
import { GEOMETRY } from '../sim/network';
import { APPROACHES, type Approach } from '../sim/types';
import { armPoint, flatScale, toWorld } from './coords';

const ASPHALT = '#3a3f47';

function Strip({ arm, lateral, from, to, width, color, y }: { arm: Approach; lateral: number; from: number; to: number; width: number; color: string; y: number }) {
  const c = armPoint(arm, (from + to) / 2, lateral);
  return (
    <mesh position={toWorld(c.x, c.y, y)} rotation-x={-Math.PI / 2} scale={flatScale(arm, to - from, width)} receiveShadow>
      <planeGeometry args={[1, 1]} />
      <meshStandardMaterial color={color} roughness={0.9} />
    </mesh>
  );
}

function Zebras() {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const d = new THREE.Object3D();
    let i = 0;
    for (const arm of APPROACHES) {
      for (let k = 0; k < 7; k++) {
        const p = armPoint(arm, CROSSWALK_DIST, -2.7 + k * 0.9);
        const [sx, sy] = flatScale(arm, CROSSWALK_W, 0.46);
        d.position.set(...toWorld(p.x, p.y, 0.045));
        d.rotation.set(-Math.PI / 2, 0, 0);
        d.scale.set(sx, sy, 1);
        d.updateMatrix();
        mesh.setMatrixAt(i++, d.matrix);
      }
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
  }, []);
  return (
    <instancedMesh ref={ref} name="crosswalks" args={[undefined, undefined, 28]} receiveShadow frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
      <meshStandardMaterial color="#f1f0ea" roughness={0.9} />
    </instancedMesh>
  );
}

/** Asphalt, double-yellow centre lines, white edge lines and zebra crosswalks. */
export function Roads() {
  const len = ROAD_LENGTH * 2;
  const from = GEOMETRY.stopLineDist;
  return (
    <group name="roads">
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]} receiveShadow>
        <planeGeometry args={[ROAD_HALF * 2, len]} />
        <meshStandardMaterial color={ASPHALT} roughness={0.95} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.021, 0]} receiveShadow>
        <planeGeometry args={[len, ROAD_HALF * 2]} />
        <meshStandardMaterial color={ASPHALT} roughness={0.95} />
      </mesh>
      {APPROACHES.map((arm) => (
        <group key={arm}>
          <Strip arm={arm} lateral={-0.13} from={from} to={ARM_END} width={0.1} color="#e3b62a" y={0.04} />
          <Strip arm={arm} lateral={0.13} from={from} to={ARM_END} width={0.1} color="#e3b62a" y={0.04} />
          <Strip arm={arm} lateral={ROAD_HALF - 0.25} from={from} to={ARM_END} width={0.12} color="#e8e8e2" y={0.04} />
          <Strip arm={arm} lateral={-(ROAD_HALF - 0.25)} from={from} to={ARM_END} width={0.12} color="#e8e8e2" y={0.04} />
        </group>
      ))}
      <Zebras />
    </group>
  );
}
