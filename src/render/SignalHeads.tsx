import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import type { FixedStepLoop } from '../runtime';
import { GEOMETRY } from '../sim/network';
import { APPROACHES, type Approach, type SignalColor } from '../sim/types';
import { ROAD_HALF, armBasis, armPoint, flatScale, toWorld } from './coords';

const LIGHT: Record<SignalColor, string> = { red: '#ff3b30', yellow: '#ffc20a', green: '#2ee66b' };
const MAST_HEIGHT = 5;

function SignalHead({ approach, loop }: { approach: Approach; loop: FixedStepLoop }) {
  const red = useRef<THREE.MeshStandardMaterial>(null);
  const yellow = useRef<THREE.MeshStandardMaterial>(null);
  const green = useRef<THREE.MeshStandardMaterial>(null);
  const stop = useRef<THREE.MeshStandardMaterial>(null);

  const { arm } = armBasis(approach);
  const pole = armPoint(approach, GEOMETRY.stopLineDist + 0.8, ROAD_HALF + 1.0);
  const line = armPoint(approach, GEOMETRY.stopLineDist, GEOMETRY.laneOffset);
  // Face the traffic arriving along the arm: local +z must point along the arm in world space.
  const yaw = Math.atan2(arm.x, -arm.y);

  useFrame(() => {
    const state = loop.runner.engine.signals[approach];
    const set = (m: THREE.MeshStandardMaterial | null, on: boolean) => {
      if (m) m.emissiveIntensity = on ? 2.4 : 0.03;
    };
    set(red.current, state === 'red');
    set(yellow.current, state === 'yellow');
    set(green.current, state === 'green');
    if (stop.current) {
      stop.current.color.set(LIGHT[state]);
      stop.current.emissive.set(LIGHT[state]);
    }
  });

  return (
    <group name={`signal-${approach}`}>
      <group position={toWorld(pole.x, pole.y)} rotation-y={yaw}>
        <mesh position={[0, MAST_HEIGHT / 2, 0]}>
          <cylinderGeometry args={[0.1, 0.12, MAST_HEIGHT, 8]} />
          <meshStandardMaterial color="#4b5563" />
        </mesh>
        <mesh position={[0, MAST_HEIGHT + 0.7, 0]}>
          <boxGeometry args={[0.75, 2.1, 0.6]} />
          <meshStandardMaterial color="#1f2328" />
        </mesh>
        {([['red', 0.65, red], ['yellow', 0, yellow], ['green', -0.65, green]] as const).map(([name, dy, ref]) => (
          <mesh key={name} position={[0, MAST_HEIGHT + 0.7 + dy, 0.32]}>
            <sphereGeometry args={[0.27, 16, 12]} />
            <meshStandardMaterial ref={ref} name={`${approach}-${name}`} color="#101214" emissive={LIGHT[name]} emissiveIntensity={0.03} />
          </mesh>
        ))}
      </group>
      <mesh name={`stopline-${approach}`} position={toWorld(line.x, line.y, 0.06)} rotation-x={-Math.PI / 2} scale={flatScale(approach, 0.55, GEOMETRY.laneOffset * 2 - 0.2)}>
        <planeGeometry args={[1, 1]} />
        <meshStandardMaterial ref={stop} color="#ff3b30" emissive="#ff3b30" emissiveIntensity={0.6} />
      </mesh>
    </group>
  );
}

/** One signal head per approach (mast beside the lane) plus a stop line that glows in the signal colour. */
export function SignalHeads({ loop }: { loop: FixedStepLoop }) {
  return (
    <group name="signals">
      {APPROACHES.map((a) => (
        <SignalHead key={a} approach={a} loop={loop} />
      ))}
    </group>
  );
}
