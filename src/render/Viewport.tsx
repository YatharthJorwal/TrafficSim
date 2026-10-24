import { Canvas } from '@react-three/fiber';
import { memo } from 'react';
import type { FixedStepLoop } from '../runtime';
import { CAMERA_PRESETS, CameraRig, type CameraRequest } from './CameraRig';
import { World, type WorldOptions } from './World';

interface Props extends WorldOptions {
  loop: FixedStepLoop;
  camera: CameraRequest;
}

/** The 3D canvas. Memoised so HUD updates in the React tree never re-render the scene. */
export const Viewport = memo(function Viewport({ loop, camera, showDetectors, showPedestrians, shadows }: Props) {
  return (
    <Canvas
      key={shadows ? 'shadows' : 'flat'}
      shadows={shadows ? 'percentage' : false}
      dpr={[1, 2]}
      camera={{ fov: 42, near: 0.5, far: 3000, position: CAMERA_PRESETS.overview.position }}
      gl={{ antialias: true }}
      onCreated={(state) => {
        // Debug hook (screenshot tooling inspects the live renderer). Nothing in the app reads it.
        (window as unknown as { __r3f?: unknown }).__r3f = state;
      }}
    >
      <World loop={loop} showDetectors={showDetectors} showPedestrians={showPedestrians} shadows={shadows} />
      <CameraRig request={camera} />
    </Canvas>
  );
});
