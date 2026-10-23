import type { FixedStepLoop } from '../runtime';
import { DetectorZones } from './DetectorZones';
import { Environment } from './Environment';
import { SignalHeads } from './SignalHeads';
import { SimDriver } from './SimDriver';
import { Vehicles } from './Vehicles';

const SKY = '#d5dde6';

/** Everything inside the canvas except the camera controls. Reads the loop; never writes simulation state. */
export function World({ loop, showDetectors }: { loop: FixedStepLoop; showDetectors: boolean }) {
  return (
    <>
      <color attach="background" args={[SKY]} />
      <fog attach="fog" args={[SKY, 150, 340]} />
      <hemisphereLight args={['#ffffff', '#8c929b', 1.0]} />
      <directionalLight position={[60, 110, 45]} intensity={1.3} />
      <SimDriver loop={loop} />
      <Environment />
      <SignalHeads loop={loop} />
      <Vehicles loop={loop} />
      {showDetectors && <DetectorZones loop={loop} />}
    </>
  );
}
