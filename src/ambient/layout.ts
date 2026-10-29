import { GEOMETRY, RING } from '../sim/network';

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
/** The arms run out to the ring road's lane centre. */
export const ROAD_LENGTH = RING.laneDist;
/** Where the simulated arm ends and the ring's slip roads begin. */
export const ARM_END = GEOMETRY.armLength;
/** City blocks fill the space between the arms' sidewalks and the ring road. */
export const BLOCK_SIZE = 91;
/** Ring road width and the perimeter wall's distance from the ring lane centre. */
export const RING_ROAD_WIDTH = 5.4;
export const RING_WALL_OFFSET = 5.6;
