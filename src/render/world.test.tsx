(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import ReactThreeTestRenderer from '@react-three/test-renderer';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PedestrianCrowd } from '../ambient/crowd';
import { ROAD_HALF } from '../ambient/layout';
import { DEFAULT_TIMING, FixedTimeController, TWO_PHASE_PLAN, planFromCycle } from '../control';
import { FixedStepLoop, SimulationRunner, interpolateVehicles } from '../runtime';
import { createConfig, uniformDemand } from '../sim/config';
import { ALL_RED } from '../sim/debugSignals';
import { GEOMETRY } from '../sim/network';
import { APPROACHES } from '../sim/types';
import { armBasis } from './coords';
import { VEHICLE_TYPES } from './models/vehicleModels';
import { World } from './World';

const makeLoop = (rate = 400) => {
  const config = createConfig({ seed: 4, duration: 900 });
  config.demand = uniformDemand(rate);
  const plan = planFromCycle(TWO_PHASE_PLAN, DEFAULT_TIMING, 60);
  return new FixedStepLoop(new SimulationRunner(config, new FixedTimeController(TWO_PHASE_PLAN, DEFAULT_TIMING, plan)));
};

const find = (root: THREE.Object3D, name: string) => {
  const o = root.getObjectByName(name);
  if (!o) throw new Error(`missing object ${name}`);
  return o;
};
const opts = { showDetectors: true, showPedestrians: true, shadows: false };
const sceneOf = (r: Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>) => r.scene.instance as THREE.Object3D;
const bodies = (scene: THREE.Object3D) => VEHICLE_TYPES.map((t) => find(scene, `vehicle-body-${t}`) as THREE.InstancedMesh);

/** Every instance of every body mesh as a world-space position and forward axis. */
function instances(scene: THREE.Object3D) {
  const out: { p: THREE.Vector3; axis: THREE.Vector3; scale: number }[] = [];
  const m = new THREE.Matrix4();
  for (const mesh of bodies(scene)) {
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      out.push({
        p: new THREE.Vector3().setFromMatrixPosition(m),
        axis: new THREE.Vector3().setFromMatrixColumn(m, 0).normalize(),
        scale: new THREE.Vector3().setFromMatrixScale(m).x,
      });
    }
  }
  return out;
}

describe('3D world (headless scene-graph test)', () => {
  it('builds the expected scene objects', async () => {
    const r = await ReactThreeTestRenderer.create(<World loop={makeLoop()} {...opts} />);
    const scene = sceneOf(r);
    for (const n of ['environment', 'terrain', 'roads', 'crosswalks', 'ring-road', 'ring-asphalt', 'ring-lines', 'ring-arrows', 'ring-wall', 'city-solid', 'city-glass', 'lamps', 'trees', 'clouds', 'vehicles', 'signals', 'ped-signals', 'pedestrians', 'detectors']) find(scene, n);
    for (const a of APPROACHES) for (const n of ['signal', 'stopline', 'detector']) find(scene, `${n}-${a}`);
    await r.unmount();
  });

  it('can hide detector zones and pedestrians', async () => {
    const r = await ReactThreeTestRenderer.create(<World loop={makeLoop()} {...opts} showDetectors={false} showPedestrians={false} />);
    expect(sceneOf(r).getObjectByName('detectors')).toBeUndefined();
    expect(sceneOf(r).getObjectByName('pedestrians')).toBeUndefined();
    await r.unmount();
  });

  it('draws one instance per simulated vehicle, at the interpolated position, pointing along its travel', async () => {
    const loop = makeLoop(600);
    loop.speed = 20;
    const r = await ReactThreeTestRenderer.create(<World loop={loop} {...opts} />);
    await r.advanceFrames(200, 0.05);
    const scene = sceneOf(r);
    expect(loop.runner.engine.vehiclesOnNetwork).toBeGreaterThan(5);
    const drawn = instances(scene);
    expect(drawn.length).toBe(loop.curr.length);

    const length = loop.runner.engine.config.vehicle.length;
    const now = interpolateVehicles(loop.prev, loop.curr, loop.alpha, length);
    const a = interpolateVehicles(loop.prev, loop.curr, 0, length);
    const b = interpolateVehicles(loop.prev, loop.curr, 1, length);
    let oriented = 0;
    now.forEach((v, i) => {
      const hit = drawn.find((d) => Math.abs(d.p.x - v.x) < 1e-4 && Math.abs(d.p.z + v.y) < 1e-4);
      expect(hit, `vehicle ${v.id} has an instance`).toBeDefined();
      const dx = b[i].x - a[i].x;
      const dy = b[i].y - a[i].y;
      const d = Math.hypot(dx, dy);
      if (d > 0.1 && Math.hypot(v.x, v.y) > 14) {
        expect(hit!.axis.x * (dx / d) + hit!.axis.z * (-dy / d)).toBeGreaterThan(0.95);
        oriented++;
      }
    });
    expect(oriented).toBeGreaterThan(3);
    await r.unmount();
  });

  it('shows brake lights exactly on the braking vehicles and indicators on turning ones', async () => {
    const loop = makeLoop(600);
    loop.speed = 20;
    const r = await ReactThreeTestRenderer.create(<World loop={loop} {...opts} />);
    let sawBrake = false;
    let sawBlink = false;
    for (let k = 0; k < 120; k++) {
      await r.advanceFrames(2, 0.05);
      const list = interpolateVehicles(loop.prev, loop.curr, loop.alpha, loop.runner.engine.config.vehicle.length);
      const brake = VEHICLE_TYPES.reduce((n, t) => n + (find(sceneOf(r), `vehicle-brake-${t}`) as THREE.InstancedMesh).count, 0);
      expect(brake).toBe(list.filter((v) => v.braking).length);
      const blink = VEHICLE_TYPES.reduce((n, t) => n + (find(sceneOf(r), `vehicle-blink-${t}`) as THREE.InstancedMesh).count, 0);
      expect(blink).toBeLessThanOrEqual(list.filter((v) => v.indicator).length);
      sawBrake ||= brake > 0;
      sawBlink ||= blink > 0;
    }
    expect(sawBrake).toBe(true);
    expect(sawBlink).toBe(true);
    await r.unmount();
  });

  it('lights exactly the signal colour the engine is using, and colours the stop line', async () => {
    const loop = makeLoop();
    loop.speed = 20;
    const r = await ReactThreeTestRenderer.create(<World loop={loop} {...opts} />);
    const scene = sceneOf(r);
    const seen = new Set<string>();
    for (let k = 0; k < 400; k++) {
      await r.advanceFrames(1, 0.05);
      for (const a of APPROACHES) {
        const state = loop.runner.engine.signals[a];
        const on = (['red', 'yellow', 'green'] as const).filter((c) => {
          let lit = false;
          find(scene, `signal-${a}`).traverse((o) => {
            const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
            if (mat && mat.name === `${a}-${c}` && mat.emissiveIntensity > 1) lit = true;
          });
          return lit;
        });
        expect(on).toEqual([state]);
        const line = (find(scene, `stopline-${a}`) as THREE.Mesh).material as THREE.MeshStandardMaterial;
        expect(line.color.getHexString()).toBe(new THREE.Color({ red: '#ff3b30', yellow: '#ffc20a', green: '#2ee66b' }[state]).getHexString());
        seen.add(state);
      }
    }
    expect(seen).toEqual(new Set(['red', 'yellow', 'green']));
    await r.unmount();
  });

  it('pedestrian signals show walk only while the road being crossed is stopped', async () => {
    const loop = makeLoop();
    loop.speed = 20;
    const r = await ReactThreeTestRenderer.create(<World loop={loop} {...opts} />);
    const scene = sceneOf(r);
    let sawWalk = false;
    for (let k = 0; k < 400; k++) {
      await r.advanceFrames(1, 0.05);
      scene.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (!mat || !mat.name.startsWith('ped-') || !mat.name.endsWith('-walk')) return;
        const arm = mat.name.split('-')[1] as 'N' | 'E' | 'S' | 'W';
        const s = loop.runner.engine.signals;
        const expected = arm === 'N' || arm === 'S' ? s.E === 'green' && s.W === 'green' && s.N === 'red' && s.S === 'red' : s.N === 'green' && s.S === 'green' && s.E === 'red' && s.W === 'red';
        expect(mat.emissiveIntensity > 1).toBe(expected);
        sawWalk ||= expected;
      });
    }
    expect(sawWalk).toBe(true);
    await r.unmount();
  });

  it('places each signal head beside its own lane, facing the traffic that must obey it', async () => {
    const r = await ReactThreeTestRenderer.create(<World loop={makeLoop()} {...opts} />);
    const scene = sceneOf(r);
    for (const a of APPROACHES) {
      const { arm, right } = armBasis(a);
      const head = find(scene, `signal-${a}`).children[0];
      const facing = head.getWorldDirection(new THREE.Vector3());
      expect(facing.x).toBeCloseTo(arm.x, 6);
      expect(facing.z).toBeCloseTo(-arm.y, 6);
      const pos = head.getWorldPosition(new THREE.Vector3());
      const sim = { x: pos.x, y: -pos.z };
      expect(sim.x * arm.x + sim.y * arm.y).toBeGreaterThan(GEOMETRY.stopLineDist);
      expect(sim.x * right.x + sim.y * right.y).toBeCloseTo(ROAD_HALF + 1, 6);
    }
    await r.unmount();
  });

  it('shows the detected queue as a zone overlay that matches the detector measurement', async () => {
    const loop = makeLoop(500);
    loop.runner.setDebugOverride(ALL_RED);
    loop.speed = 20;
    const r = await ReactThreeTestRenderer.create(<World loop={loop} {...opts} />);
    await r.advanceFrames(400, 0.05);
    const scene = sceneOf(r);
    let checked = 0;
    for (const a of APPROACHES) {
      const m = loop.runner.detectors.measurements[a].observed;
      const q = find(scene, `queue-${a}`) as THREE.Mesh;
      expect(q.visible).toBe(m.queueLengthM > 0);
      if (q.visible) {
        expect(a === 'N' || a === 'S' ? q.scale.y : q.scale.x).toBeCloseTo(m.queueLengthM, 6);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(3);
    await r.unmount();
  });

  it('draws the crowd, and the crowd follows the loop (steps with it, resets with it)', async () => {
    const loop = makeLoop();
    loop.speed = 20;
    const r = await ReactThreeTestRenderer.create(<World loop={loop} {...opts} />);
    const scene = sceneOf(r);
    await r.advanceFrames(100, 0.05);
    for (const part of ['torso', 'head', 'legL', 'legR', 'armL', 'armR']) expect((find(scene, `ped-${part}`) as THREE.InstancedMesh).count).toBe(14);
    const torso = find(scene, 'ped-torso') as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    const before: number[] = [];
    for (let i = 0; i < 14; i++) { torso.getMatrixAt(i, m); before.push(m.elements[12] + m.elements[14]); }
    await r.advanceFrames(100, 0.05);
    let moved = 0;
    for (let i = 0; i < 14; i++) { torso.getMatrixAt(i, m); if (Math.abs(m.elements[12] + m.elements[14] - before[i]) > 0.5) moved++; }
    expect(moved).toBeGreaterThan(3);
    expect(new PedestrianCrowd(14, 11).peds.length).toBe(14);
    await r.unmount();
  });

  it('does not advance the simulation while paused', async () => {
    const loop = makeLoop();
    loop.running = false;
    const r = await ReactThreeTestRenderer.create(<World loop={loop} {...opts} />);
    await r.advanceFrames(60, 0.05);
    expect(loop.runner.engine.steps).toBe(0);
    await r.unmount();
  });
});
