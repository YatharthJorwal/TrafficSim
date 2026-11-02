import { getTerrain } from './scenery/cache';

/** Faceted low-poly ground: flat around the city, rolling hills further out. */
export function Terrain() {
  const geometry = getTerrain();
  return (
    <mesh name="terrain" geometry={geometry} position={[0, -0.01, 0]} receiveShadow>
      <meshStandardMaterial vertexColors roughness={1} />
    </mesh>
  );
}
