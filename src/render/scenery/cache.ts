import { buildCity, type CityParts } from './city';
import { buildRingRoad, type RingRoadParts } from './ring';
import { buildTerrain, scatterOutskirtTrees } from './terrain';

/**
 * Static scenery is deterministic, so it is built once per page and shared. The start-up sequence builds it ahead of the
 * first frame (see `prewarmScene`), which is what makes the "Building the city" stage real work. Disposing a geometry
 * on unmount only frees its GPU copy; three.js uploads it again if the scene is mounted again.
 */
function once<T>(build: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= build());
}

export const getCity = once<CityParts>(() => buildCity());
export const getOutskirtTrees = once(() => scatterOutskirtTrees());
export const getTerrain = once(buildTerrain);
export const getRingRoad = once<RingRoadParts>(buildRingRoad);

/** Build all static scenery now. Safe to call more than once. */
export function prewarmScene(): void {
  getCity();
  getOutskirtTrees();
  getTerrain();
  getRingRoad();
}
