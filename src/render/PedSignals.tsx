import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { CROSSWALK_DIST, CROSSWALK_W, ROAD_HALF } from '../ambient/layout';
import { permitted } from '../ambient/crowd';
import type { FixedStepLoop } from '../runtime';
import { APPROACHES, type Approach } from '../sim/types';
import { armBasis, armPoint, toWorld } from './coords';

const POST = 2.6;

function PedHead({ arm, side, loop }: { arm: Approach; side: 1 | -1; loop: FixedStepLoop }) {
  const walk = useRef<THREE.MeshStandardMaterial>(null);
  const stop = useRef<THREE.MeshStandardMaterial>(null);
  const { right } = armBasis(arm);
  const p = armPoint(arm, CROSSWALK_DIST + CROSSWALK_W / 2 + 0.6, side * (ROAD_HALF + 0.4));
  // face across the road, towards pedestrians waiting on the far side
  const dir = { x: -side * right.x, y: -side * right.y };
  const yaw = Math.atan2(dir.x, -dir.y);

  useFrame(() => {
    const ok = !loop.runner.overridden && permitted(arm, loop.runner.engine.signals);
    if (walk.current) walk.current.emissiveIntensity = ok ? 2.2 : 0.03;
    if (stop.current) stop.current.emissiveIntensity = ok ? 0.03 : 2.2;
  });

  return (
    <group position={toWorld(p.x, p.y)} rotation-y={yaw}>
      <mesh position={[0, POST / 2, 0]}>
        <cylinderGeometry args={[0.05, 0.06, POST, 6]} />
        <meshStandardMaterial color="#4b5563" />
      </mesh>
      <mesh position={[0, POST + 0.3, 0]}>
        <boxGeometry args={[0.32, 0.72, 0.24]} />
        <meshStandardMaterial color="#1f2328" />
      </mesh>
      <mesh position={[0, POST + 0.46, 0.13]}>
        <sphereGeometry args={[0.09, 10, 8]} />
        <meshStandardMaterial ref={stop} name={`ped-${arm}-${side}-stop`} color="#101214" emissive="#ff3b30" emissiveIntensity={0.03} />
      </mesh>
      <mesh position={[0, POST + 0.14, 0.13]}>
        <sphereGeometry args={[0.09, 10, 8]} />
        <meshStandardMaterial ref={walk} name={`ped-${arm}-${side}-walk`} color="#101214" emissive="#2ee66b" emissiveIntensity={0.03} />
      </mesh>
    </group>
  );
}

/** Pedestrian signal heads at both ends of every crosswalk (red hand / green walker colours as lamps). */
export function PedSignals({ loop }: { loop: FixedStepLoop }) {
  return (
    <group name="ped-signals">
      {APPROACHES.flatMap((arm) => ([1, -1] as const).map((side) => <PedHead key={`${arm}${side}`} arm={arm} side={side} loop={loop} />))}
    </group>
  );
}
