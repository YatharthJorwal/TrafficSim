import { Canvas, useFrame } from '@react-three/fiber';
import { memo, useRef } from 'react';
import type { FixedStepLoop } from '../runtime';
import { CAMERA_PRESETS, CameraRig, type CameraRequest } from './CameraRig';
import { World, type WorldOptions } from './World';

export { prewarmScene } from './scenery/cache';

interface Props extends WorldOptions {
  loop: FixedStepLoop;
  camera: CameraRequest;
  /** False while another tab is showing: the render loop (and so the simulation it drives) pauses. */
  active?: boolean;
  /** Called once, after a few frames have actually been drawn. */
  onFirstFrame?: () => void;
}

/** Reports when real frames have been drawn (the third frame callback means two have been painted). */
function FirstFrame({ onFrame }: { onFrame: () => void }) {
  const n = useRef(0);
  useFrame(() => {
    if (n.current < 3 && ++n.current === 3) onFrame();
  });
  return null;
}

/** The 3D canvas. Memoised so HUD updates in the React tree never re-render the scene. */
export const Viewport = memo(function Viewport({ loop, camera, showDetectors, showPedestrians, shadows, active = true, onFirstFrame }: Props) {
  return (
    <Canvas
      key={shadows ? 'shadows' : 'flat'}
      frameloop={active ? 'always' : 'never'}
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
      {onFirstFrame && <FirstFrame onFrame={onFirstFrame} />}
    </Canvas>
  );
});
