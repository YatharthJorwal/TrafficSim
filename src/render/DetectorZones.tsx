import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import type { FixedStepLoop } from '../runtime';
import { GEOMETRY } from '../sim/network';
import { APPROACHES, type Approach } from '../sim/types';
import { armPoint, flatScale, toWorld } from './coords';

const IDLE = new THREE.Color('#3b82f6');
const ACTIVE = new THREE.Color('#06b6d4');
const OVERFLOW = new THREE.Color('#ef4444');
const LANE_W = GEOMETRY.laneOffset * 2 - 0.3;

function Zone({ approach, loop }: { approach: Approach; loop: FixedStepLoop }) {
  const zone = useRef<THREE.Mesh>(null);
  const zoneMat = useRef<THREE.MeshBasicMaterial>(null);
  const queue = useRef<THREE.Mesh>(null);
  const zoneLength = loop.runner.detectors.config.zoneLength;
  const stop = GEOMETRY.stopLineDist;

  useFrame(() => {
    const m = loop.runner.detectors.measurements[approach].observed;
    const z = zone.current;
    const q = queue.current;
    if (!z || !q || !zoneMat.current) return;
    zoneMat.current.color.copy(m.zoneOverflow ? OVERFLOW : m.inZone > 0 ? ACTIVE : IDLE);
    zoneMat.current.opacity = m.zoneOverflow ? 0.3 : m.inZone > 0 ? 0.24 : 0.1;

    q.visible = m.queueLengthM > 0;
    if (q.visible) {
      const c = armPoint(approach, stop + m.queueLengthM / 2, GEOMETRY.laneOffset);
      q.position.set(...toWorld(c.x, c.y, 0.09));
      q.scale.set(...flatScale(approach, m.queueLengthM, LANE_W - 0.2));
    }
  });

  const centre = armPoint(approach, stop + zoneLength / 2, GEOMETRY.laneOffset);
  return (
    <group name={`detector-${approach}`}>
      <mesh ref={zone} position={toWorld(centre.x, centre.y, 0.07)} rotation-x={-Math.PI / 2} scale={flatScale(approach, zoneLength, LANE_W)}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial ref={zoneMat} color="#3b82f6" transparent opacity={0.1} depthWrite={false} />
      </mesh>
      <mesh ref={queue} name={`queue-${approach}`} rotation-x={-Math.PI / 2} visible={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color="#f97316" transparent opacity={0.55} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** Translucent detector zones on each approach: blue idle, cyan occupied, red if the queue may overflow; orange = queue. */
export function DetectorZones({ loop }: { loop: FixedStepLoop }) {
  return (
    <group name="detectors">
      {APPROACHES.map((a) => (
        <Zone key={a} approach={a} loop={loop} />
      ))}
    </group>
  );
}
