import { useMemo } from 'react';
import { buildTerrain } from './scenery/terrain';

/** Faceted low-poly ground: flat around the city, rolling hills further out. */
export function Terrain() {
  const geometry = useMemo(buildTerrain, []);
  return (
    <mesh name="terrain" geometry={geometry} position={[0, -0.01, 0]} receiveShadow>
      <meshStandardMaterial vertexColors roughness={1} />
    </mesh>
  );
}
