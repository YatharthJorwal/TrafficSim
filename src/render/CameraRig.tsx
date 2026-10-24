import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

export type CameraPresetName = 'overview' | 'closeup' | 'street' | 'top';

export const CAMERA_PRESETS: Record<CameraPresetName, { label: string; position: [number, number, number] }> = {
  overview: { label: 'Overview', position: [26, 112, 52] },
  closeup: { label: 'Intersection', position: [4, 16, 32] },
  street: { label: 'Street', position: [-1.8, 2.5, 36] },
  top: { label: 'Top-down', position: [0, 125, 0.01] },
};

export interface CameraRequest {
  name: CameraPresetName;
  /** Change to re-apply the same preset after the user has moved the camera. */
  nonce: number;
}

/** Orbit controls with animated presets. Dragging cancels an animation in progress. */
export function CameraRig({ request }: { request: CameraRequest }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const target = useRef(new THREE.Vector3(...CAMERA_PRESETS.overview.position));
  const animating = useRef(false);
  const origin = useRef(new THREE.Vector3(0, 0, 0));

  useEffect(() => {
    target.current.set(...CAMERA_PRESETS[request.name].position);
    animating.current = true;
  }, [request]);

  useFrame((_, delta) => {
    if (!animating.current) return;
    const k = 1 - Math.exp(-6 * Math.min(delta, 0.1));
    camera.position.lerp(target.current, k);
    controls.current?.target.lerp(origin.current, k);
    controls.current?.update();
    if (camera.position.distanceTo(target.current) < 0.05) animating.current = false;
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      minDistance={12}
      maxDistance={220}
      maxPolarAngle={Math.PI / 2 - 0.05}
      onStart={() => {
        animating.current = false;
      }}
    />
  );
}
