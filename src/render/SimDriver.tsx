import { useFrame } from '@react-three/fiber';
import type { FixedStepLoop } from '../runtime';

/**
 * Advances the simulation from the render loop. It only converts elapsed real time into whole fixed steps
 * (FixedStepLoop), so results never depend on frame rate. Runs before every other frame callback.
 */
export function SimDriver({ loop }: { loop: FixedStepLoop }) {
  useFrame((_, delta) => {
    loop.advance(delta);
  }, -1);
  return null;
}
