import { Canvas } from '@react-three/fiber';
import { memo } from 'react';
import type { FixedStepLoop } from '../runtime';
import { CAMERA_PRESETS, CameraRig, type CameraRequest } from './CameraRig';
import { World } from './World';

interface Props {
  loop: FixedStepLoop;
  showDetectors: boolean;
  camera: CameraRequest;
}

/** The 3D canvas. Memoised so HUD updates in the React tree never re-render the scene. */
export const Viewport = memo(function Viewport({ loop, showDetectors, camera }: Props) {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ fov: 42, near: 0.5, far: 700, position: CAMERA_PRESETS.overview.position }}
      gl={{ antialias: true }}
    >
      <World loop={loop} showDetectors={showDetectors} />
      <CameraRig request={camera} />
    </Canvas>
  );
});
