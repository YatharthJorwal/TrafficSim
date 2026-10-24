import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { PedestrianCrowd } from '../ambient/crowd';
import type { FixedStepLoop } from '../runtime';
import { paint } from './scenery/geom';

const MAX = 40;
const OUTFITS = ['#c0493d', '#2f6f8f', '#d4a23c', '#4d8a5e', '#7b5aa6', '#e8e6df', '#3b3f46', '#d97b3d'];
const TROUSERS = ['#2d3748', '#3b4a63', '#4a4036', '#222428', '#5b6470'];
const SKIN = ['#f1c9a5', '#e0ac85', '#c68b63', '#8d5a3b', '#5e3b26'];

function part(g: THREE.BufferGeometry, color = '#ffffff') {
  return paint(g, color);
}

/** Low-poly walkers: torso, head and swinging arms and legs, as six instanced meshes. */
export function Pedestrians({ loop }: { loop: FixedStepLoop }) {
  const crowd = useMemo(() => new PedestrianCrowd(14, 11), []);
  const geo = useMemo(() => {
    const torso = new THREE.BoxGeometry(0.42, 0.6, 0.26);
    const head = new THREE.IcosahedronGeometry(0.14, 0);
    head.scale(1, 1.15, 1);
    const leg = new THREE.BoxGeometry(0.15, 0.78, 0.15);
    leg.translate(0, -0.39, 0);
    const arm = new THREE.BoxGeometry(0.11, 0.58, 0.11);
    arm.translate(0, -0.29, 0);
    return { torso: part(torso), head: part(head), leg: part(leg), arm: part(arm) };
  }, []);
  const refs = useRef<Record<'torso' | 'head' | 'legL' | 'legR' | 'armL' | 'armR', THREE.InstancedMesh | null>>({
    torso: null, head: null, legL: null, legR: null, armL: null, armR: null,
  });
  const scratch = useMemo(() => ({ base: new THREE.Matrix4(), local: new THREE.Matrix4(), out: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(), c: new THREE.Color() }), []);

  useEffect(() => {
    const dt = loop.runner.engine.config.dt;
    const length = loop.runner.engine.config.vehicle.length;
    const offStep = loop.onStep((r) =>
      crowd.step(dt, { signals: r.engine.signals, overridden: r.overridden, vehicles: r.lastObservations, vehicleLength: length }),
    );
    const offReset = loop.onReset(() => crowd.reset());
    return () => {
      offStep();
      offReset();
    };
  }, [loop, crowd]);

  useFrame(() => {
    const r = refs.current;
    if (!r.torso || !r.head || !r.legL || !r.legR || !r.armL || !r.armR) return;
    const { base, local, out, q, p, s, c } = scratch;
    const alpha = loop.alpha;
    const peds = crowd.peds;
    const n = Math.min(peds.length, MAX);
    const put = (mesh: THREE.InstancedMesh, i: number, ox: number, oy: number, oz: number, rz: number) => {
      local.makeRotationZ(rz).setPosition(ox, oy, oz);
      out.multiplyMatrices(base, local);
      mesh.setMatrixAt(i, out);
    };
    for (let i = 0; i < n; i++) {
      const ped = peds[i];
      const x = ped.px + (ped.x - ped.px) * alpha;
      const y = ped.py + (ped.y - ped.py) * alpha;
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, ped.heading);
      p.set(x, 0.15, -y);
      s.setScalar(ped.height);
      base.compose(p, q, s);
      const swing = ped.walking ? Math.sin(ped.gait * 2.7) : 0;
      put(r.torso, i, 0, 1.15, 0, 0);
      put(r.head, i, 0, 1.58, 0, 0);
      put(r.legL, i, 0, 0.8, -0.11, swing * 0.55);
      put(r.legR, i, 0, 0.8, 0.11, -swing * 0.55);
      put(r.armL, i, 0, 1.4, -0.27, -swing * 0.45);
      put(r.armR, i, 0, 1.4, 0.27, swing * 0.45);
      r.torso.setColorAt(i, c.set(OUTFITS[ped.outfit % OUTFITS.length]));
      r.armL.setColorAt(i, c.set(OUTFITS[ped.outfit % OUTFITS.length]));
      r.armR.setColorAt(i, c.set(OUTFITS[ped.outfit % OUTFITS.length]));
      r.head.setColorAt(i, c.set(SKIN[ped.skin % SKIN.length]));
      r.legL.setColorAt(i, c.set(TROUSERS[ped.trousers % TROUSERS.length]));
      r.legR.setColorAt(i, c.set(TROUSERS[ped.trousers % TROUSERS.length]));
    }
    for (const m of [r.torso, r.head, r.legL, r.legR, r.armL, r.armR]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  });

  const mesh = (key: keyof typeof refs.current, geometry: THREE.BufferGeometry) => (
    <instancedMesh ref={(m) => { refs.current[key] = m; }} name={`ped-${key}`} args={[geometry, undefined, MAX]} castShadow frustumCulled={false}>
      <meshStandardMaterial flatShading roughness={0.85} />
    </instancedMesh>
  );
  return (
    <group name="pedestrians">
      {mesh('torso', geo.torso)}
      {mesh('head', geo.head)}
      {mesh('legL', geo.leg)}
      {mesh('legR', geo.leg)}
      {mesh('armL', geo.arm)}
      {mesh('armR', geo.arm)}
    </group>
  );
}
