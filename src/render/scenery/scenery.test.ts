import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CROSSWALK_DIST, CROSSWALK_W, RING_ROAD_WIDTH } from '../../ambient/layout';
import { GEOMETRY, RING_PATH } from '../../sim/network';
import { BODY_COLORS, VEHICLE_TYPES, buildVehicleModel, vehicleTypeFor } from '../models/vehicleModels';
import { buildCity } from './city';
import { ringSamples } from './ring';
import { FLAT_RADIUS, buildTerrain, scatterOutskirtTrees, terrainHeight } from './terrain';

function vertices(g: THREE.BufferGeometry) {
  const p = g.attributes.position;
  const out: [number, number, number][] = [];
  for (let i = 0; i < p.count; i++) out.push([p.getX(i), p.getY(i), p.getZ(i)]);
  return out;
}

describe('street layout', () => {
  it('puts the crosswalk between the box edge and the stop line', () => {
    expect(CROSSWALK_DIST - CROSSWALK_W / 2).toBeGreaterThan(GEOMETRY.boxHalf);
    expect(CROSSWALK_DIST + CROSSWALK_W / 2).toBeLessThan(GEOMETRY.stopLineDist);
  });
});

describe('city generator', () => {
  const city = buildCity();

  it('is deterministic for a seed and varies with it', () => {
    const again = buildCity();
    expect(again.stats).toEqual(city.stats);
    expect(again.solid.attributes.position.count).toBe(city.solid.attributes.position.count);
    expect(again.glass.attributes.position.array).toEqual(city.glass.attributes.position.array);
    const other = buildCity(8);
    expect(other.solid.attributes.position.count === city.solid.attributes.position.count && JSON.stringify(other.stats) === JSON.stringify(city.stats) && other.glass.attributes.position.array.every((v, i) => v === city.glass.attributes.position.array[i])).toBe(false);
  });

  it('has a believable amount of city', () => {
    expect(city.stats.buildings).toBeGreaterThanOrEqual(30);
    expect(city.stats.towers).toBeGreaterThanOrEqual(3);
    expect(city.stats.windows).toBeGreaterThan(1500);
    expect(city.stats.parks).toBe(2);
    expect(city.lamps.length).toBeGreaterThan(20);
    expect(city.trees.length).toBeGreaterThan(20);
  });

  it('never puts solid geometry or windows on the roadway', () => {
    for (const g of [city.solid, city.glass]) {
      for (const [x, , z] of vertices(g)) expect(Math.min(Math.abs(x), Math.abs(z))).toBeGreaterThanOrEqual(3.49);
    }
  });

  it('keeps buildings inside their blocks and at a sane height', () => {
    city.glass.computeBoundingBox();
    const box = city.solid.boundingBox!;
    expect(box.max.y).toBeLessThan(60);
    expect(box.max.y).toBeGreaterThan(25);
    expect(Math.max(Math.abs(box.min.x), Math.abs(box.max.x))).toBeLessThanOrEqual(151);
    for (const [x, y, z] of vertices(city.glass)) {
      expect(Math.min(Math.abs(x), Math.abs(z))).toBeGreaterThan(6.4); // windows only on buildings, never on pavement
      expect(y).toBeGreaterThan(0);
    }
  });

  it('keeps the corner lots low so the junction stays visible', () => {
    // anything tall must be well away from the intersection corners
    for (const [x, y, z] of vertices(city.solid)) {
      if (y > 14) expect(Math.max(Math.abs(x), Math.abs(z))).toBeGreaterThan(14);
    }
  });

  it('keeps lamps and trees off the arms and the ring road', () => {
    const ring = ringSamples(0, RING_PATH.length, 1);
    const onRoad = (x: number, z: number) => {
      if (Math.min(Math.abs(x), Math.abs(z)) < 3.5 && Math.max(Math.abs(x), Math.abs(z)) <= 106) return true; // an arm
      return ring.some((p) => Math.hypot(p.x - x, p.y + z) < RING_ROAD_WIDTH / 2 + 0.2);
    };
    for (const l of city.lamps) expect(onRoad(l.x, l.z), `lamp ${l.x.toFixed(1)},${l.z.toFixed(1)}`).toBe(false);
    for (const t of city.trees) expect(onRoad(t.x, t.z), `tree ${t.x.toFixed(1)},${t.z.toFixed(1)}`).toBe(false);
  });

  it('fills the space out to the ring road and no further', () => {
    for (const [x, , z] of vertices(city.glass)) expect(Math.max(Math.abs(x), Math.abs(z))).toBeLessThanOrEqual(98.5);
    city.glass.computeBoundingBox();
    expect(city.glass.boundingBox!.max.x).toBeGreaterThan(80); // buildings really reach the outer part of each block
  });
});

describe('terrain', () => {
  it('is flat around the city and hilly beyond', () => {
    for (const [x, z] of [[0, 0], [100, 100], [-120, 40], [FLAT_RADIUS - 1, 0]]) expect(terrainHeight(x, z)).toBe(0);
    let max = 0;
    for (let a = 0; a < 6.28; a += 0.2) max = Math.max(max, terrainHeight(Math.cos(a) * 300, Math.sin(a) * 300));
    expect(max).toBeGreaterThan(8);
    expect(max).toBeLessThan(60);
    expect(terrainHeight(250, 90)).toBe(terrainHeight(250, 90));
  });
  it('builds a deterministic coloured mesh', () => {
    const a = buildTerrain();
    const b = buildTerrain();
    expect(a.attributes.position.count).toBe(b.attributes.position.count);
    expect(a.attributes.color.array).toEqual(b.attributes.color.array);
    expect(a.attributes.color).toBeDefined();
  });
  it('scatters trees clear of the city and the roads', () => {
    const trees = scatterOutskirtTrees();
    expect(trees.length).toBe(360);
    expect(scatterOutskirtTrees()).toEqual(trees);
    for (const t of trees) expect(Math.max(Math.abs(t.x), Math.abs(t.z))).toBeGreaterThanOrEqual(128);
  });
});

describe('vehicle models', () => {
  it('fit inside the simulated vehicle footprint and sit on the ground', () => {
    for (const type of VEHICLE_TYPES) {
      const m = buildVehicleModel(type);
      for (const g of [m.body, m.details]) {
        g.computeBoundingBox();
        const bb = g.boundingBox!;
        expect(bb.max.x - bb.min.x).toBeLessThanOrEqual(4.5);
        expect(bb.max.z - bb.min.z).toBeLessThanOrEqual(2.1);
        expect(bb.max.y).toBeGreaterThan(1.2);
        expect(bb.max.y).toBeLessThan(2.2);
        expect(Math.abs(bb.min.x + bb.max.x)).toBeLessThan(0.1); // centred along its length
      }
      m.details.computeBoundingBox();
      expect(m.details.boundingBox!.min.y).toBeCloseTo(0, 2); // wheels touch the road
      expect(m.details.attributes.color).toBeDefined();
      expect(m.length).toBeLessThanOrEqual(4.5);
    }
  });
  it('has brake lights at the rear and indicators on one side only', () => {
    for (const type of VEHICLE_TYPES) {
      const m = buildVehicleModel(type);
      m.brake.computeBoundingBox();
      expect(m.brake.boundingBox!.max.x).toBeLessThan(0);
      m.blink.computeBoundingBox();
      expect(m.blink.boundingBox!.max.z).toBeLessThan(0); // left side only; mirrored for the right
    }
  });
  it('assigns types and colours deterministically with a sensible mix', () => {
    const counts: Record<string, number> = { sedan: 0, hatch: 0, suv: 0, van: 0 };
    for (let id = 1; id <= 1000; id++) counts[vehicleTypeFor(id)]++;
    expect(vehicleTypeFor(77)).toBe(vehicleTypeFor(77));
    expect(counts.sedan).toBeGreaterThan(350);
    expect(counts.van).toBeGreaterThan(40);
    expect(counts.van).toBeLessThan(200);
    expect(new Set(BODY_COLORS).size).toBe(BODY_COLORS.length);
  });
});
