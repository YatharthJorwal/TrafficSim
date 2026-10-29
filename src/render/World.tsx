import type { FixedStepLoop } from '../runtime';
import { DetectorZones } from './DetectorZones';
import { Environment } from './Environment';
import { PedSignals } from './PedSignals';
import { Pedestrians } from './Pedestrians';
import { SignalHeads } from './SignalHeads';
import { SimDriver } from './SimDriver';
import { SUN_DIRECTION, SkyAndClouds } from './Sky';
import { Vehicles } from './Vehicles';

const HORIZON = '#cddbe8';

export interface WorldOptions {
  showDetectors: boolean;
  showPedestrians: boolean;
  shadows: boolean;
}

/** Everything inside the canvas except the camera controls. Reads the loop; never writes simulation state. */
export function World({ loop, showDetectors, showPedestrians, shadows }: { loop: FixedStepLoop } & WorldOptions) {
  const sun = SUN_DIRECTION.clone().multiplyScalar(160);
  return (
    <>
      <fog attach="fog" args={[HORIZON, 330, 950]} />
      <hemisphereLight args={['#dbe9ff', '#7d8a6c', 1.15]} />
      <directionalLight
        position={sun.toArray()}
        intensity={2.4}
        color="#fff3dc"
        castShadow={shadows}
        shadow-mapSize={[3072, 3072]}
        shadow-camera-left={-125}
        shadow-camera-right={125}
        shadow-camera-top={125}
        shadow-camera-bottom={-125}
        shadow-camera-near={20}
        shadow-camera-far={520}
        shadow-bias={-0.0004}
        shadow-normalBias={0.06}
      />
      <SkyAndClouds />
      <SimDriver loop={loop} />
      <Environment />
      <SignalHeads loop={loop} />
      <PedSignals loop={loop} />
      <Vehicles loop={loop} />
      {showPedestrians && <Pedestrians loop={loop} />}
      {showDetectors && <DetectorZones loop={loop} />}
    </>
  );
}
