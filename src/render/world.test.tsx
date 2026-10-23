(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import ReactThreeTestRenderer from '@react-three/test-renderer';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMING, FixedTimeController, TWO_PHASE_PLAN, planFromCycle } from '../control';
import { FixedStepLoop, SimulationRunner, interpolateVehicles } from '../runtime';
import { createConfig, uniformDemand } from '../sim/config';
import { ALL_RED } from '../sim/debugSignals';
import { GEOMETRY } from '../sim/network';
import { APPROACHES } from '../sim/types';
import { ROAD_HALF, armBasis } from './coords';
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

describe('3D world (headless scene-graph test)', () => {
  it('builds the expected scene objects', async () => {
    const loop = makeLoop();
    const r = await ReactThreeTestRenderer.create(<World loop={loop} showDetectors />);
    const scene = r.scene.instance as THREE.Object3D;
    for (const n of ['environment', 'vehicles', 'signals', 'detectors', 'vehicle-bodies', 'vehicle-cabins']) find(scene, n);
    for (const a of APPROACHES) {
      find(scene, `signal-${a}`);
      find(scene, `stopline-${a}`);
      find(scene, `detector-${a}`);
    }
    await r.unmount();
  });

  it('hides detector zones when switched off', async () => {
    const r = await ReactThreeTestRenderer.create(<World loop={makeLoop()} showDetectors={false} />);
    expect((r.scene.instance as THREE.Object3D).getObjectByName('detectors')).toBeUndefined();
    await r.unmount();
  });

  it('draws one instance per simulated vehicle, at the interpolated position', async () => {
    const loop = makeLoop(600);
    loop.speed = 20;
    const r = await ReactThreeTestRenderer.create(<World loop={loop} showDetectors />);
    await r.advanceFrames(200, 0.05);
    const bodies = find(r.scene.instance as THREE.Object3D, 'vehicle-bodies') as THREE.InstancedMesh;
    expect(loop.runner.engine.vehiclesOnNetwork).toBeGreaterThan(5);
    expect(bodies.count).toBe(loop.curr.length);

    const expected = interpolateVehicles(loop.prev, loop.curr, loop.alpha, loop.runner.engine.config.vehicle.length);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (let i = 0; i < Math.min(5, expected.length); i++) {
      bodies.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      expect(p.x).toBeCloseTo(expected[i].x, 4);
      expect(p.z).toBeCloseTo(-expected[i].y, 4);
      expect(p.y).toBeGreaterThan(0);
    }
    await r.unmount();
  });

  it('lights exactly the signal colour the engine is using, and colours the stop line', async () => {
    const loop = makeLoop();
    loop.speed = 20;
    const r = await ReactThreeTestRenderer.create(<World loop={loop} showDetectors />);
    const scene = r.scene.instance as THREE.Object3D;
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

  it('shows the detected queue as a zone overlay that matches the detector measurement', async () => {
    const loop = makeLoop(500);
    loop.runner.setDebugOverride(ALL_RED);
    loop.speed = 20;
    const r = await ReactThreeTestRenderer.create(<World loop={loop} showDetectors />);
    await r.advanceFrames(400, 0.05);
    const scene = r.scene.instance as THREE.Object3D;
    let checked = 0;
    for (const a of APPROACHES) {
      const m = loop.runner.detectors.measurements[a].observed;
      const q = find(scene, `queue-${a}`) as THREE.Mesh;
      expect(q.visible).toBe(m.queueLengthM > 0);
      if (q.visible) {
        const along = a === 'N' || a === 'S' ? q.scale.y : q.scale.x;
        expect(along).toBeCloseTo(m.queueLengthM, 6);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(3);
    await r.unmount();
  });

  it('places each signal head beside its own lane, facing the traffic that must obey it', async () => {
    const r = await ReactThreeTestRenderer.create(<World loop={makeLoop()} showDetectors />);
    const scene = r.scene.instance as THREE.Object3D;
    for (const a of APPROACHES) {
      const { arm, right } = armBasis(a);
      const head = find(scene, `signal-${a}`).children[0];
      const facing = head.getWorldDirection(new THREE.Vector3());
      expect(facing.x).toBeCloseTo(arm.x, 6);
      expect(facing.z).toBeCloseTo(-arm.y, 6);
      const pos = head.getWorldPosition(new THREE.Vector3());
      const sim = { x: pos.x, y: -pos.z };
      const along = sim.x * arm.x + sim.y * arm.y;
      const lateral = sim.x * right.x + sim.y * right.y;
      expect(along).toBeGreaterThan(GEOMETRY.stopLineDist);
      expect(lateral).toBeCloseTo(ROAD_HALF + 1, 6);
    }
    await r.unmount();
  });

  it('points every moving vehicle along its direction of travel', async () => {
    const loop = makeLoop(600);
    loop.speed = 10;
    const r = await ReactThreeTestRenderer.create(<World loop={loop} showDetectors />);
    await r.advanceFrames(150, 0.05);
    const bodies = find(r.scene.instance as THREE.Object3D, 'vehicle-bodies') as THREE.InstancedMesh;
    const length = loop.runner.engine.config.vehicle.length;
    const a = interpolateVehicles(loop.prev, loop.curr, 0, length);
    const b = interpolateVehicles(loop.prev, loop.curr, 1, length);
    const m = new THREE.Matrix4();
    let checked = 0;
    for (let i = 0; i < b.length; i++) {
      const dx = b[i].x - a[i].x;
      const dy = b[i].y - a[i].y;
      const d = Math.hypot(dx, dy);
      if (d < 0.1 || Math.hypot(b[i].x, b[i].y) < 12) continue; // straight stretches only
      bodies.getMatrixAt(i, m);
      const axis = new THREE.Vector3().setFromMatrixColumn(m, 0).normalize();
      expect(axis.x * (dx / d) + axis.z * (-dy / d)).toBeGreaterThan(0.95);
      checked++;
    }
    expect(checked).toBeGreaterThan(3);
    await r.unmount();
  });

  it('does not advance the simulation while paused', async () => {
    const loop = makeLoop();
    loop.running = false;
    const r = await ReactThreeTestRenderer.create(<World loop={loop} showDetectors />);
    await r.advanceFrames(60, 0.05);
    expect(loop.runner.engine.steps).toBe(0);
    await r.unmount();
  });
});
