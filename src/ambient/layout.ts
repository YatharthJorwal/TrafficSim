import { GEOMETRY } from '../sim/network';

/**
 * Visual street layout shared by the scenery and the cosmetic pedestrian crowd.
 * Distances are metres; "lateral" is measured from the road centreline.
 */
export const ROAD_HALF = GEOMETRY.laneOffset * 2;
export const SIDEWALK_W = 3;
export const SIDEWALK_OUT = ROAD_HALF + SIDEWALK_W;
/** Where pedestrians walk, lateral to the road centreline. */
export const PED_LATERAL = ROAD_HALF + SIDEWALK_W / 2;
/** Crosswalk centre, measured out along an arm from the intersection centre. Sits between the box and the stop line. */
export const CROSSWALK_DIST = 7.2;
export const CROSSWALK_W = 3;
/** Visual road half-length (the simulation uses GEOMETRY.armLength). */
export const ROAD_LENGTH = 150;
export const BLOCK_SIZE = 45;
