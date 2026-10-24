import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { FixedStepLoop } from '../runtime';
import { interpolateVehicles } from '../runtime';
import { BODY_COLORS, VEHICLE_TYPES, buildVehicleModel, vehicleTypeFor, type VehicleModel, type VehicleType } from './models/vehicleModels';

const MAX_PER_TYPE = 300;
const BLINK_HZ = 1.6;

interface Rig {
  body: THREE.InstancedMesh | null;
  details: THREE.InstancedMesh | null;
  brake: THREE.InstancedMesh | null;
  blink: THREE.InstancedMesh | null;
}

/**
 * All vehicles, drawn as four low-poly types (sedan, hatchback, SUV, van), each with tinted bodies,
 * brake lights while slowing or stopped, and blinking indicators when about to turn.
 * Poses are interpolated between fixed simulation steps; vehicles grow in and out at the arm ends.
 */
export function Vehicles({ loop }: { loop: FixedStepLoop }) {
  const models = useMemo(() => VEHICLE_TYPES.map((t) => buildVehicleModel(t)), []);
  const rigs = useRef<Record<VehicleType, Rig>>({
    sedan: { body: null, details: null, brake: null, blink: null },
    hatch: { body: null, details: null, brake: null, blink: null },
    suv: { body: null, details: null, brake: null, blink: null },
    van: { body: null, details: null, brake: null, blink: null },
  });
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const length = loop.runner.engine.config.vehicle.length;

  useFrame((state) => {
    const list = interpolateVehicles(loop.prev, loop.curr, loop.alpha, length);
    const blinkOn = Math.floor(state.clock.elapsedTime * BLINK_HZ * 2) % 2 === 0;
    const used: Record<VehicleType, { n: number; brake: number; blink: number }> = {
      sedan: { n: 0, brake: 0, blink: 0 }, hatch: { n: 0, brake: 0, blink: 0 }, suv: { n: 0, brake: 0, blink: 0 }, van: { n: 0, brake: 0, blink: 0 },
    };
    for (const v of list) {
      const type = vehicleTypeFor(v.id);
      const rig = rigs.current[type];
      const u = used[type];
      if (!rig.body || !rig.details || !rig.brake || !rig.blink || u.n >= MAX_PER_TYPE) continue;
      const f = Math.max(0.001, v.fade);
      dummy.position.set(v.x, 0, -v.y);
      dummy.rotation.set(0, v.heading, 0);
      dummy.scale.setScalar(f);
      dummy.updateMatrix();
      rig.body.setMatrixAt(u.n, dummy.matrix);
      rig.details.setMatrixAt(u.n, dummy.matrix);
      color.set(BODY_COLORS[(Math.imul(v.id, 40503) >>> 0) % BODY_COLORS.length]);
      rig.body.setColorAt(u.n, color);
      u.n++;
      if (v.braking) rig.brake.setMatrixAt(u.brake++, dummy.matrix);
      if (v.indicator && blinkOn) {
        dummy.scale.set(f, f, f * (v.indicator === 'right' ? -1 : 1));
        dummy.updateMatrix();
        rig.blink.setMatrixAt(u.blink++, dummy.matrix);
      }
    }
    for (const t of VEHICLE_TYPES) {
      const rig = rigs.current[t];
      const u = used[t];
      if (!rig.body || !rig.details || !rig.brake || !rig.blink) continue;
      rig.body.count = rig.details.count = u.n;
      rig.brake.count = u.brake;
      rig.blink.count = u.blink;
      for (const m of [rig.body, rig.details, rig.brake, rig.blink]) m.instanceMatrix.needsUpdate = true;
      if (rig.body.instanceColor) rig.body.instanceColor.needsUpdate = true;
    }
  });

  return (
    <group name="vehicles">
      {models.map((m: VehicleModel) => (
        <group key={m.type}>
          <instancedMesh ref={(r) => { rigs.current[m.type].body = r; }} name={`vehicle-body-${m.type}`} args={[m.body, undefined, MAX_PER_TYPE]} castShadow frustumCulled={false}>
            <meshStandardMaterial flatShading roughness={0.45} metalness={0.2} />
          </instancedMesh>
          <instancedMesh ref={(r) => { rigs.current[m.type].details = r; }} name={`vehicle-details-${m.type}`} args={[m.details, undefined, MAX_PER_TYPE]} castShadow frustumCulled={false}>
            <meshStandardMaterial vertexColors flatShading roughness={0.6} />
          </instancedMesh>
          <instancedMesh ref={(r) => { rigs.current[m.type].brake = r; }} name={`vehicle-brake-${m.type}`} args={[m.brake, undefined, MAX_PER_TYPE]} frustumCulled={false}>
            <meshBasicMaterial color="#ff2a22" toneMapped={false} />
          </instancedMesh>
          <instancedMesh ref={(r) => { rigs.current[m.type].blink = r; }} name={`vehicle-blink-${m.type}`} args={[m.blink, undefined, MAX_PER_TYPE]} frustumCulled={false}>
            <meshBasicMaterial color="#ffa51f" toneMapped={false} side={THREE.DoubleSide} />
          </instancedMesh>
        </group>
      ))}
    </group>
  );
}
