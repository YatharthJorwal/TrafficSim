import { useMemo } from 'react';
import { Lamps } from './Lamps';
import { Roads } from './Roads';
import { Terrain } from './Terrain';
import { Trees } from './Trees';
import { buildCity } from './scenery/city';
import { scatterOutskirtTrees } from './scenery/terrain';

/** Static scenery: terrain, roads and markings, the city, street furniture and trees. Built once, deterministically. */
export function Environment() {
  const city = useMemo(() => buildCity(), []);
  const trees = useMemo(() => [...city.trees, ...scatterOutskirtTrees()], [city]);
  return (
    <group name="environment">
      <Terrain />
      <Roads />
      <mesh name="city-solid" geometry={city.solid} castShadow receiveShadow>
        <meshStandardMaterial vertexColors flatShading roughness={0.92} />
      </mesh>
      <mesh name="city-glass" geometry={city.glass}>
        <meshStandardMaterial vertexColors flatShading roughness={0.25} metalness={0.15} />
      </mesh>
      <Lamps spots={city.lamps} />
      <Trees spots={trees} />
    </group>
  );
}
