import { GEOMETRY, NETWORK } from '../sim/network';
import { mulberry32 } from '../sim/rng';
import type { Approach, SignalStates, VehicleObservation } from '../sim/types';
import { APPROACHES } from '../sim/types';
import { CROSSWALK_DIST, PED_LATERAL } from './layout';

/**
 * Cosmetic pedestrians. They live on a small sidewalk graph, cross only when the traffic they walk
 * across is red, and wait for turning cars still near the crosswalk. They READ the simulation but never
 * change it, so removing them cannot alter any result. Driven by simulation time (one step per tick).
 */

const FAR = 45; // how far along an arm a stroll goes
const CROSS_WINDOW_START = 0.4; // s after the parallel phase turns green
const CROSS_WINDOW_END = 3.0;
const CROSS_LENGTH = PED_LATERAL * 2;
/** A pedestrian who has waited this long for a gap picks another way instead. */
const GIVE_UP_AFTER = 16; // s
const CAR_MARGIN = 1.0; // s on top of the crossing time
/** Bounds used to find the EARLIEST a car could reach the crosswalk (it may accelerate). */
const CAR_MAX_ACCEL = 1.6;
const CAR_MAX_SPEED = 15.5;

interface Node { id: string; x: number; y: number; far: boolean }
interface Edge { a: number; b: number; len: number; crossing: Approach | null }

export interface PedState {
  id: number;
  x: number;
  y: number;
  /** Position one step ago, for smooth rendering between steps. */
  px: number;
  py: number;
  heading: number;
  walking: boolean;
  /** Distance walked (drives the leg swing). */
  gait: number;
  crossing: Approach | null;
  outfit: number;
  trousers: number;
  skin: number;
  height: number;
}

export interface CrowdContext {
  signals: Readonly<SignalStates>;
  /** When true the signals are a debug override: nobody crosses. */
  overridden: boolean;
  vehicles: readonly VehicleObservation[];
  vehicleLength: number;
}

interface Walker {
  state: PedState;
  edge: number;
  from: number;
  to: number;
  progress: number;
  speed: number;
  pause: number;
  waiting: boolean;
  waited: number;
}

function buildGraph() {
  const nodes: Node[] = [];
  const index = new Map<string, number>();
  const add = (id: string, x: number, y: number, far = false) => {
    index.set(id, nodes.length);
    nodes.push({ id, x, y, far });
  };
  const P = PED_LATERAL;
  const C = CROSSWALK_DIST;
  add('c:NE', P, P); add('c:NW', -P, P); add('c:SW', -P, -P); add('c:SE', P, -P);
  const curb = (arm: Approach, side: 1 | -1) => (arm === 'N' ? [side * P, C] : arm === 'S' ? [side * P, -C] : arm === 'E' ? [C, side * P] : [-C, side * P]);
  const far = (arm: Approach, side: 1 | -1) => (arm === 'N' ? [side * P, FAR] : arm === 'S' ? [side * P, -FAR] : arm === 'E' ? [FAR, side * P] : [-FAR, side * P]);
  for (const arm of APPROACHES) {
    for (const side of [1, -1] as const) {
      const [cx, cy] = curb(arm, side);
      add(`k:${arm}:${side}`, cx, cy);
      const [fx, fy] = far(arm, side);
      add(`f:${arm}:${side}`, fx, fy, true);
    }
  }
  const edges: Edge[] = [];
  const link = (u: string, v: string, crossing: Approach | null = null) => {
    const a = index.get(u)!;
    const b = index.get(v)!;
    edges.push({ a, b, len: Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y), crossing });
  };
  // corners to the curb nodes of the two arms they touch
  link('c:NE', 'k:N:1'); link('c:NE', 'k:E:1');
  link('c:NW', 'k:N:-1'); link('c:NW', 'k:W:1');
  link('c:SW', 'k:S:-1'); link('c:SW', 'k:W:-1');
  link('c:SE', 'k:S:1'); link('c:SE', 'k:E:-1');
  for (const arm of APPROACHES) {
    link(`k:${arm}:1`, `k:${arm}:-1`, arm);
    link(`k:${arm}:1`, `f:${arm}:1`);
    link(`k:${arm}:-1`, `f:${arm}:-1`);
  }
  return { nodes, edges };
}

const GRAPH = buildGraph();
export const PED_NODES = GRAPH.nodes;
export const PED_EDGES = GRAPH.edges;

/** Walking across arm A goes parallel to the other road, so it is allowed while that road is green. */
export function permitted(arm: Approach, s: Readonly<SignalStates>): boolean {
  return arm === 'N' || arm === 'S'
    ? s.E === 'green' && s.W === 'green' && s.N === 'red' && s.S === 'red'
    : s.N === 'green' && s.S === 'green' && s.E === 'red' && s.W === 'red';
}

/** Earliest time (s) a car could cover `d` metres, starting at speed `v` and accelerating as hard as it plausibly can. */
function earliestCover(d: number, v: number): number {
  if (d <= 0) return 0;
  return Math.max(d / CAR_MAX_SPEED, (-v + Math.sqrt(v * v + 2 * CAR_MAX_ACCEL * d)) / CAR_MAX_ACCEL);
}

/**
 * True when a car that will drive over the crosswalk across `arm` could arrive before a pedestrian
 * starting now would be across. Cars cannot take turns faster than the route's turn speed, so turning
 * traffic is slowed in the box; every other bound assumes the car accelerates as hard as it can.
 */
export function carBlocksCrossing(arm: Approach, vehicles: readonly VehicleObservation[], vehicleLength: number, crossSpeed: number): boolean {
  const crossTime = CROSS_LENGTH / crossSpeed + CAR_MARGIN;
  for (const v of vehicles) {
    const route = NETWORK.routes[v.routeIndex];
    let ahead: number;
    if (route.exit === arm) {
      // leaving along this arm: the crosswalk lies just beyond the box exit
      ahead = route.boxExitS + (CROSSWALK_DIST - GEOMETRY.boxHalf) - v.s;
    } else if (route.approach === arm && v.s >= route.stopLineS - 0.2) {
      // arriving on this arm but already past the stop line, i.e. not waiting behind it
      ahead = GEOMETRY.armLength - CROSSWALK_DIST - v.s;
    } else continue;
    if (ahead < -(vehicleLength + 1)) continue; // already past
    if (ahead <= 0) return true; // on the crosswalk right now
    let earliest: number;
    if (route.turnSpeed !== Infinity && route.exit === arm && v.s < route.boxEnterS) {
      const toBox = route.boxEnterS - v.s;
      earliest = earliestCover(toBox, v.speed) + (ahead - toBox) / (route.turnSpeed * 1.15);
    } else {
      earliest = earliestCover(ahead, v.speed);
    }
    if (earliest < crossTime) return true;
  }
  return false;
}

export class PedestrianCrowd {
  readonly seed: number;
  private walkers: Walker[] = [];
  private rng: () => number;
  private clock = 0;
  private greenSince: Record<'NS' | 'EW', number | null> = { NS: null, EW: null };
  private crossings = 0;

  constructor(readonly count = 14, seed = 11) {
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.reset();
  }

  get peds(): readonly PedState[] {
    return this.walkers.map((w) => w.state);
  }
  /** Completed street crossings since the last reset. */
  get completedCrossings(): number {
    return this.crossings;
  }

  reset(): void {
    this.rng = mulberry32(this.seed);
    this.clock = 0;
    this.crossings = 0;
    this.greenSince = { NS: null, EW: null };
    const walkable = GRAPH.edges.map((e, i) => (e.crossing ? -1 : i)).filter((i) => i >= 0);
    this.walkers = [];
    for (let i = 0; i < this.count; i++) {
      const edge = walkable[Math.floor(this.rng() * walkable.length)];
      const e = GRAPH.edges[edge];
      const forward = this.rng() < 0.5;
      const progress = this.rng() * e.len;
      const from = forward ? e.a : e.b;
      const to = forward ? e.b : e.a;
      const speed = 1.15 + this.rng() * 0.35;
      const w: Walker = {
        edge, from, to, progress, speed, pause: 0, waiting: false, waited: 0,
        state: {
          id: i, x: 0, y: 0, px: 0, py: 0, heading: 0, walking: true, gait: this.rng() * 6, crossing: null,
          outfit: Math.floor(this.rng() * 8), trousers: Math.floor(this.rng() * 5), skin: Math.floor(this.rng() * 5), height: 0.92 + this.rng() * 0.16,
        },
      };
      this.place(w);
      w.state.px = w.state.x;
      w.state.py = w.state.y;
      this.walkers.push(w);
    }
  }

  step(dt: number, ctx: CrowdContext): void {
    this.clock += dt;
    this.trackPhases(ctx);
    for (const w of this.walkers) {
      w.state.px = w.state.x;
      w.state.py = w.state.y;
      if (w.pause > 0) {
        w.pause -= dt;
        w.state.walking = false;
        continue;
      }
      if (w.waiting) {
        const arm = GRAPH.edges[w.edge].crossing!;
        if (this.mayStart(arm, ctx, w.speed)) {
          w.waiting = false;
          w.waited = 0;
          w.state.crossing = arm;
        } else {
          w.waited += dt;
          w.state.walking = false;
          if (w.waited > GIVE_UP_AFTER && this.giveUp(w)) w.state.walking = true;
          else continue;
        }
      }
      w.state.walking = true;
      const step = w.speed * dt;
      w.progress += step;
      w.state.gait += step;
      const e = GRAPH.edges[w.edge];
      if (w.progress >= e.len) {
        if (e.crossing) this.crossings++;
        w.state.crossing = null;
        this.arrive(w);
      }
      this.place(w);
    }
  }

  private trackPhases(ctx: CrowdContext): void {
    const ns = !ctx.overridden && ctx.signals.N === 'green' && ctx.signals.S === 'green';
    const ew = !ctx.overridden && ctx.signals.E === 'green' && ctx.signals.W === 'green';
    this.greenSince.NS = ns ? (this.greenSince.NS ?? this.clock) : null;
    this.greenSince.EW = ew ? (this.greenSince.EW ?? this.clock) : null;
  }

  private mayStart(arm: Approach, ctx: CrowdContext, speed: number): boolean {
    if (ctx.overridden || !permitted(arm, ctx.signals)) return false;
    // arms N/S are crossed on the E-W green, and vice versa
    const since = arm === 'N' || arm === 'S' ? this.greenSince.EW : this.greenSince.NS;
    if (since === null) return false;
    const age = this.clock - since;
    if (age < CROSS_WINDOW_START || age > CROSS_WINDOW_END) return false;
    return !carBlocksCrossing(arm, ctx.vehicles, ctx.vehicleLength, speed);
  }

  private arrive(w: Walker): void {
    const prev = w.from;
    w.from = w.to;
    const node = GRAPH.nodes[w.from];
    const options: number[] = [];
    GRAPH.edges.forEach((e, i) => {
      if (e.a === w.from || e.b === w.from) options.push(i);
    });
    let choices = options.filter((i) => {
      const e = GRAPH.edges[i];
      return (e.a === w.from ? e.b : e.a) !== prev;
    });
    if (choices.length === 0) choices = options;
    if (node.far) w.pause = 0.3 + this.rng() * 2.2;
    w.edge = this.pick(choices);
    const e = GRAPH.edges[w.edge];
    w.to = e.a === w.from ? e.b : e.a;
    w.progress = 0;
    w.waiting = e.crossing !== null;
    w.waited = 0;
  }

  /** Strolling is more likely than crossing; the dead-end stroll nodes are mildly favoured. */
  private pick(edges: number[]): number {
    const weight = (i: number) => (GRAPH.edges[i].crossing ? 0.55 : GRAPH.nodes[GRAPH.edges[i].a].far || GRAPH.nodes[GRAPH.edges[i].b].far ? 1.2 : 1);
    const total = edges.reduce((n, i) => n + weight(i), 0);
    let u = this.rng() * total;
    for (const i of edges) {
      u -= weight(i);
      if (u <= 0) return i;
    }
    return edges[edges.length - 1];
  }

  /** Abandon a crossing that never opened up and walk another sidewalk instead. */
  private giveUp(w: Walker): boolean {
    const options: number[] = [];
    GRAPH.edges.forEach((e, i) => {
      if (!e.crossing && (e.a === w.from || e.b === w.from)) options.push(i);
    });
    if (options.length === 0) return false;
    w.edge = this.pick(options);
    const e = GRAPH.edges[w.edge];
    w.to = e.a === w.from ? e.b : e.a;
    w.progress = 0;
    w.waiting = false;
    w.waited = 0;
    return true;
  }

  private place(w: Walker): void {
    const a = GRAPH.nodes[w.from];
    const b = GRAPH.nodes[w.to];
    const e = GRAPH.edges[w.edge];
    const t = Math.min(1, w.progress / e.len);
    w.state.x = a.x + (b.x - a.x) * t;
    w.state.y = a.y + (b.y - a.y) * t;
    w.state.heading = Math.atan2(b.y - a.y, b.x - a.x);
  }
}
