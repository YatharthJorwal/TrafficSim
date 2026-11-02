import { useMemo } from 'react';
import { Lamps } from './Lamps';
import { RingRoad } from './RingRoad';
import { Roads } from './Roads';
import { Terrain } from './Terrain';
import { Trees } from './Trees';
import { getCity, getOutskirtTrees } from './scenery/cache';

/** Static scenery: terrain, roads and markings, the city, street furniture and trees. Built once, deterministically. */
export function Environment() {
  const city = getCity();
  const trees = useMemo(() => [...city.trees, ...getOutskirtTrees()], [city]);
  return (
    <group name="environment">
      <Terrain />
      <Roads />
      <RingRoad />
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
