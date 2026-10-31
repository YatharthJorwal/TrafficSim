import { assertValidConfig, MAX_FLEET } from './config';
import { obbOverlap } from './collision';
import { GEOMETRY, NETWORK, OPPOSITE, RING_PATH, poseAt, type Network, type Route } from './network';
import { SPAWN_INTERVAL, fleetArrival, generateSchedule, pickMovement } from './schedule';
import { deriveSeed, mulberry32 } from './rng';
import {
  APPROACHES,
  MOVEMENTS,
  type Approach,
  type Arrival,
  type ApproachCounts,
  type EngineStats,
  type Movement,
  type SignalStates,
  type SimConfig,
  type SimSnapshot,
  type VehicleLedgerEntry,
  type VehicleObservation,
  type VehicleParams,
  type VehicleRecord,
} from './types';

/** Left-turners behave as if they would arrive this many seconds later (permissive-left gap acceptance). */
const LEFT_PENALTY = 3.5;
/** Merging movements only negotiate when their arrival times are this close (s). */
const MERGE_WINDOW = 2.0;
/** Speed floor used when estimating time-to-stop-line (m/s). */
const ETA_MIN_SPEED = 2.0;
/** A vehicle only commits to stopping on yellow if it can do so at this deceleration (m/s^2). */
const YELLOW_STOP_DECEL = 3.0;
/** A waiting left-turner may sit this far beyond its nominal pocket position (it stops asymptotically) and is still held (m). */
const POCKET_SLACK = 3;
/** Hard anti-overlap guard threshold (m). */
const HARD_MIN_GAP = 0.1;
/** Held vehicles aim to stop this far short of the stop line, so numerical creep never crosses it (m). */
const STOP_MARGIN = 0.5;

// Ring road
/** Distance from the box exit to the arm end (identical for every main route). */
const EXIT_REMAINDER = GEOMETRY.armLength - GEOMETRY.boxHalf;
/** Start of the lane's last stretch before the box; leaders on the lane matter up to here. */
const LANE_END = GEOMETRY.armLength - GEOMETRY.boxHalf;
/** Vehicles this far into an exit arc, or this far into an entry arc, still occupy the ring lane. */
const ARC_TAIL = 6.5;
const ARC_HEAD = 8;
/** Exiting vehicles start watching the ring this far from the arm end (m). */
const YIELD_LOOKAHEAD = 50;
/** Gap acceptance: a ring vehicle reaching the merge point within this many seconds of the merging one blocks it. */
const MERGE_TIME = 2.4;
const MERGE_UPSTREAM = 140;
/** A new vehicle will not spawn if a ring vehicle bound for the same entry is this close behind it (m). */
const SPAWN_CLEAR = 25;
const GRID = 8;

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Time to cover `dist` from speed `v0`, accelerating at `acc` up to `vCap`. */
function timeToCover(dist: number, v0: number, acc: number, vCap: number): number {
  if (dist <= 0) return 0;
  const v = Math.min(v0, vCap);
  const tAcc = (vCap - v) / acc;
  const dAcc = ((v + vCap) / 2) * tAcc;
  if (dAcc >= dist) return (-v + Math.sqrt(v * v + 2 * acc * dist)) / acc;
  return tAcc + (dist - dAcc) / vCap;
}

interface Vehicle {
  id: number;
  route: Route;
  s: number;
  v: number;
  a: number;
  desiredSpeed: number;
  generatedAt: number;
  insertedAt: number;
  stopLineTime: number;
  waitingTime: number;
  stoppedTime: number;
  ranRed: boolean;
  /** Legs completed. */
  legs: number;
  /** Circulating mode: the arm to enter after the next exit, and the movement to make there. */
  plannedTarget: Approach;
  plannedMovement: Movement;
  /** Per-vehicle stream for choosing later legs: independent of timing, so identical for every controller. */
  rng: () => number;
  // per-step scratch
  exitOffset: number;
  exitCoord: number;
  laneOff: number;
  laneS: number;
  ringU: number;
  eta: number;
  key: number;
  sigBlocked: boolean;
  /** Queue head that cannot go because a left-turner is waiting in the box across its path. */
  pocketBlocked: boolean;
  held: boolean;
  leader: Vehicle | null;
  leaderGap: number;
  leaderOffset: number;
  nextS: number;
  nextV: number;
  nextA: number;
}

export interface EngineOptions {
  /** Share one pre-generated schedule between engines (e.g. fixed vs adaptive runs). */
  schedule?: readonly Arrival[];
  /** Enables per-step body-overlap checks. Costs a little; on in tests and debug views. */
  diagnostics?: boolean;
  signals?: SignalStates;
}

function newCounts(): ApproachCounts {
  return { generated: 0, inserted: 0, enteredIntersection: 0, exited: 0 };
}

function newStats(): EngineStats {
  return {
    ...newCounts(),
    perApproach: { N: newCounts(), E: newCounts(), S: newCounts(), W: newCounts() },
    redLightEntries: 0,
    safetyClamps: 0,
    overlapPairSteps: 0,
    firstOverlap: null,
    minGap: Infinity,
    maxSpeed: 0,
    maxAccel: 0,
    maxDecel: 0,
  };
}

const allGreen = (): SignalStates => ({ N: 'green', E: 'green', S: 'green', W: 'green' });

/**
 * Deterministic, fixed-timestep microscopic traffic engine for one four-way intersection.
 *
 * - No randomness at run time: arrivals, speed factors and (in circulating mode) every vehicle's future
 *   route choices come from seeded streams that do not depend on timing or on the controller.
 * - Signal states are *inputs* (setSignals); the engine never decides them.
 * - The renderer reads snapshot()/observe(); it is never the source of truth.
 * - Two traffic modes: 'arrivals' (open boundary, used for experiments) and 'circulating' (a fixed fleet that
 *   leaves through an arm, drives round the ring road and re-enters, so nothing ever disappears).
 */
export class SimulationEngine {
  readonly config: SimConfig;
  readonly network: Network = NETWORK;
  /** The base schedule (arrivals, or the initial fleet placement). Vehicles added later are not in here. */
  readonly schedule: readonly Arrival[];

  private readonly p: VehicleParams;
  private readonly diagnostics: boolean;
  private readonly circulating: boolean;
  private signalStates: SignalStates;

  private mains = {} as Record<Approach, Record<Movement, Route>>;
  private connectors = {} as Record<Approach, Record<Approach, Route>>;

  private vehicles: Vehicle[] = [];
  private stepCount = 0;
  private pending: Arrival[] = [];
  private nextArrival = 0;
  private fleetCount = 0;
  private backlog: Record<Approach, Arrival[]> = { N: [], E: [], S: [], W: [] };
  private _stats: EngineStats = newStats();
  private _completed: VehicleRecord[] = [];
  private _clampSamples: string[] = [];

  private byApproach: Record<Approach, Vehicle[]> = { N: [], E: [], S: [], W: [] };
  private exitGroups: Record<Approach, Vehicle[]> = { N: [], E: [], S: [], W: [] };
  private ring: Vehicle[] = [];
  private heads: Vehicle[] = [];
  private occupants: Vehicle[] = [];
  /** Per arm: its entry queue has backed up to (almost) the ring. */
  private spill: Record<Approach, boolean> = { N: false, E: false, S: false, W: false };

  constructor(config: SimConfig, options: EngineOptions = {}) {
    assertValidConfig(config);
    this.config = JSON.parse(JSON.stringify(config)) as SimConfig;
    this.p = this.config.vehicle;
    this.circulating = this.config.mode === 'circulating';
    this.schedule = options.schedule ?? generateSchedule(this.config);
    this.diagnostics = options.diagnostics ?? false;
    this.signalStates = options.signals ? { ...options.signals } : allGreen();
    for (const a of APPROACHES) {
      this.mains[a] = {} as Record<Movement, Route>;
      this.connectors[a] = {} as Record<Approach, Route>;
      for (const m of MOVEMENTS) this.mains[a][m] = this.network.route(a, m);
      for (const t of APPROACHES) this.connectors[a][t] = this.network.connector(a, t);
    }
    this.reset();
  }

  // ---------------------------------------------------------------- public API

  get time(): number {
    return this.stepCount * this.config.dt;
  }
  get steps(): number {
    return this.stepCount;
  }
  get stats(): Readonly<EngineStats> {
    return this._stats;
  }
  get completed(): readonly VehicleRecord[] {
    return this._completed;
  }
  /** First few anti-overlap guard interventions, for debugging (route, position, leader). */
  get clampSamples(): readonly string[] {
    return this._clampSamples;
  }
  get vehiclesOnNetwork(): number {
    return this.vehicles.length;
  }
  get signals(): Readonly<SignalStates> {
    return this.signalStates;
  }
  /** Circulating mode: vehicles spawned or queued to spawn (the fleet size). */
  get fleetSize(): number {
    return this.fleetCount;
  }
  get isCirculating(): boolean {
    return this.circulating;
  }

  /** Vehicles generated but not yet placed on the road because the entry was occupied. */
  backlogCount(approach: Approach): number {
    return this.backlog[approach].length;
  }

  /**
   * Arrivals mode: one ledger entry per generated vehicle (exited, on the road, or still in the entry backlog),
   * for experiment metrics. Read-only. Order: exited, on the road, backlog.
   */
  ledger(): VehicleLedgerEntry[] {
    if (this.circulating) throw new Error('ledger() needs arrivals mode: circulating vehicles never finish');
    const out: VehicleLedgerEntry[] = [];
    for (const r of this._completed) {
      out.push({
        id: r.id,
        approach: r.approach,
        movement: r.movement,
        generatedAt: r.generatedAt,
        status: 'exited',
        backlogWait: r.insertedAt - r.generatedAt,
        queueWait: r.waitingTime,
        stoppedTime: r.stoppedTime,
      });
    }
    for (const v of this.vehicles) {
      out.push({
        id: v.id,
        approach: v.route.approach,
        movement: this.movementOf(v),
        generatedAt: v.generatedAt,
        status: 'onRoad',
        backlogWait: v.insertedAt - v.generatedAt,
        queueWait: v.waitingTime,
        stoppedTime: v.stoppedTime,
      });
    }
    const now = this.time;
    for (const approach of APPROACHES) {
      for (const arr of this.backlog[approach]) {
        out.push({
          id: arr.id,
          approach,
          movement: arr.movement,
          generatedAt: arr.time,
          status: 'backlog',
          backlogWait: now - arr.time,
          queueWait: 0,
          stoppedTime: 0,
        });
      }
    }
    return out;
  }

  setSignals(states: SignalStates): void {
    this.signalStates = { ...states };
  }

  /**
   * Circulating mode only: add `count` vehicles, spawning round robin at the four fixed entries starting now.
   * Returns how many were added (the fleet is capped at MAX_FLEET).
   */
  addVehicles(count: number): number {
    if (!this.circulating) throw new Error('addVehicles needs circulating mode');
    const n = Math.max(0, Math.min(Math.floor(count), MAX_FLEET - this.fleetCount));
    const now = this.time;
    for (let j = 0; j < n; j++) {
      const arrival = fleetArrival(this.config, this.fleetCount, now + Math.floor(j / APPROACHES.length) * SPAWN_INTERVAL);
      this.fleetCount++;
      // keep the not-yet-released part sorted by time (stable for equal times)
      let lo = this.nextArrival;
      let hi = this.pending.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (this.pending[mid].time <= arrival.time) lo = mid + 1;
        else hi = mid;
      }
      this.pending.splice(lo, 0, arrival);
    }
    return n;
  }

  /** Restart from t = 0 with the same config and schedule. Signals are left untouched. */
  reset(): void {
    this.vehicles = [];
    this.stepCount = 0;
    this.pending = this.schedule.slice();
    this.nextArrival = 0;
    this.fleetCount = this.circulating ? this.schedule.length : 0;
    this.backlog = { N: [], E: [], S: [], W: [] };
    this._stats = newStats();
    this._completed = [];
    this._clampSamples = [];
  }

  run(untilTime: number): void {
    const targetSteps = Math.round(untilTime / this.config.dt);
    while (this.stepCount < targetSteps) this.step();
  }

  /** Advance exactly one fixed timestep. */
  step(): void {
    const dt = this.config.dt;
    const t = this.stepCount * dt;
    this.releaseArrivals(t);
    this.insertFromBacklog(t);
    this.retargetRingVehicles();
    this.prepare();
    this.computeAccelerations();
    this.integrate(dt, t + dt);
    if (this.diagnostics) this.checkOverlaps(t + dt);
    this.stepCount++;
  }

  /** Read-only per-vehicle view (no poses). Used by detectors and by the renderer's interpolation. */
  observe(): VehicleObservation[] {
    return this.vehicles.map((v) => ({
      id: v.id,
      routeIndex: v.route.index,
      approach: v.route.approach,
      movement: this.movementOf(v),
      s: v.s,
      speed: v.v,
      distanceToStopLine: v.route.stopLineS - v.s,
      held: v.held,
      leg: v.legs,
      persistent: this.circulating,
    }));
  }

  snapshot(): SimSnapshot {
    return {
      time: this.time,
      signals: { ...this.signalStates },
      vehicles: this.vehicles.map((v) => {
        const pose = poseAt(v.route, v.s - this.p.length / 2);
        return {
          id: v.id,
          approach: v.route.approach,
          movement: this.movementOf(v),
          speed: v.v,
          accel: v.a,
          length: this.p.length,
          width: this.p.width,
          held: v.held,
          ...pose,
        };
      }),
    };
  }

  /** Exact textual fingerprint of the full simulation state (for determinism tests). */
  stateKey(): string {
    const parts = this.vehicles.map((v) => `${v.id}:${v.route.index}:${v.s}:${v.v}:${v.a}`);
    const st = this._stats;
    return `${this.stepCount}|${st.generated},${st.inserted},${st.enteredIntersection},${st.exited}|${parts.join(';')}`;
  }

  private movementOf(v: Vehicle): Movement {
    return v.route.kind === 'main' ? v.route.movement : v.plannedMovement;
  }

  // ---------------------------------------------------------------- arrivals

  private releaseArrivals(t: number): void {
    while (this.nextArrival < this.pending.length && this.pending[this.nextArrival].time <= t) {
      const arr = this.pending[this.nextArrival++];
      this.backlog[arr.approach].push(arr);
      this._stats.generated++;
      this._stats.perApproach[arr.approach].generated++;
    }
  }

  private samplePlan(v: Vehicle): void {
    const target = APPROACHES[Math.min(APPROACHES.length - 1, Math.floor(v.rng() * APPROACHES.length))];
    v.plannedTarget = target;
    v.plannedMovement = pickMovement(this.config.demand[target].turnMix, v.rng());
  }

  private insertFromBacklog(t: number): void {
    const p = this.p;
    for (const approach of APPROACHES) {
      const queue = this.backlog[approach];
      if (queue.length === 0) continue;
      const arr = queue[0];

      // Rearmost vehicle already on this arm's entry lane is the one the new vehicle would follow.
      let rear: Vehicle | null = null;
      for (const v of this.vehicles) {
        if (v.route.kind === 'main' && v.route.approach === approach && (rear === null || v.s < rear.s)) rear = v;
      }
      // Ring traffic about to turn into this arm must not be right behind the spawn point.
      let crowded = false;
      for (const v of this.vehicles) {
        if (v.route.kind === 'connector' && v.route.approach === approach) {
          const lane = v.s - v.route.length;
          if (lane > -SPAWN_CLEAR) crowded = true;
        }
      }
      if (crowded) continue;

      const desired = p.freeSpeed * arr.speedFactor;
      let vInit = desired;
      if (rear) {
        const gap = rear.s - p.length; // new vehicle front is at s = 0
        if (gap < p.minGap + 1) continue;
        const safe = Math.sqrt(rear.v * rear.v + 2 * p.comfortDecel * Math.max(0, gap - p.minGap));
        vInit = Math.min(desired, safe);
      }

      queue.shift();
      const route = this.mains[arr.approach][arr.movement];
      const veh: Vehicle = {
        id: arr.id,
        route,
        s: 0,
        v: vInit,
        a: 0,
        desiredSpeed: desired,
        generatedAt: arr.time,
        insertedAt: t,
        stopLineTime: -1,
        waitingTime: 0,
        stoppedTime: 0,
        ranRed: false,
        legs: 0,
        plannedTarget: arr.approach,
        plannedMovement: arr.movement,
        rng: mulberry32(deriveSeed(this.config.seed ^ 0x51ed270b, arr.id)),
        exitOffset: 0,
        exitCoord: 0,
        laneOff: 0,
        laneS: 0,
        ringU: NaN,
        eta: 0,
        key: Infinity,
        sigBlocked: false,
        pocketBlocked: false,
        held: false,
        leader: null,
        leaderGap: Infinity,
        leaderOffset: 0,
        nextS: 0,
        nextV: 0,
        nextA: 0,
      };
      if (this.circulating) this.samplePlan(veh);
      this.vehicles.push(veh);
      this._stats.inserted++;
      this._stats.perApproach[approach].inserted++;
    }
  }

  /**
   * Ring traffic does not turn into an arm whose entry queue has backed up to the ring (it would block the
   * whole ring and gridlock the city). It takes the next arm instead, switching to a connector that shares
   * the same path so the vehicle does not jump. The replacement movement comes from a hash, not the
   * vehicle's stream, so every controller still sees the same sequence of choices.
   */
  private retargetRingVehicles(): void {
    if (!this.circulating) return;
    for (const a of APPROACHES) this.spill[a] = false;
    for (const v of this.vehicles) if (v.route.kind === 'main' && v.s < 25 && v.v < 1.5) this.spill[v.route.approach] = true;
    if (!APPROACHES.some((a) => this.spill[a])) return;
    for (const v of this.vehicles) {
      const r = v.route;
      if (r.kind !== 'connector' || v.s < r.ringStartS || !this.spill[r.approach]) continue;
      const toGo = r.ringEndS - v.s;
      if (toGo > 45 || toGo < 12) continue;
      const i = APPROACHES.indexOf(r.approach);
      for (let k = 1; k < APPROACHES.length; k++) {
        const target = APPROACHES[(i + k) % APPROACHES.length];
        if (this.spill[target]) continue;
        const c = this.connectors[r.exit][target];
        if (c.ringEndS - 8 <= v.s) continue;
        const u = (Math.imul(v.id * 7919 + v.legs * 104729 + k, 2654435761) >>> 0) / 4294967296;
        v.route = c;
        v.plannedTarget = target;
        v.plannedMovement = pickMovement(this.config.demand[target].turnMix, u);
        break;
      }
    }
  }

  // ---------------------------------------------------------------- per-step indices

  private signalBlocks(v: Vehicle): boolean {
    const color = this.signalStates[v.route.approach];
    if (color === 'green') return false;
    const dist = v.route.stopLineS - v.s;
    if (color === 'yellow') return (v.v * v.v) / (2 * YELLOW_STOP_DECEL) <= dist;
    // Red: stop if physically possible; otherwise the vehicle is committed and counted as a red entry.
    return (v.v * v.v) / (2 * this.p.maxDecel) <= dist + 0.5;
  }

  private prepare(): void {
    const len = this.p.length;
    const P = RING_PATH.length;
    for (const a of APPROACHES) {
      this.byApproach[a].length = 0;
      this.exitGroups[a].length = 0;
    }
    this.heads.length = 0;
    this.occupants.length = 0;
    this.ring.length = 0;

    for (const v of this.vehicles) {
      const r = v.route;
      v.leader = null;
      v.leaderGap = Infinity;
      v.leaderOffset = 0;
      v.held = false;
      v.sigBlocked = false;
      v.pocketBlocked = false;
      v.ringU = NaN;

      if (r.kind === 'main') {
        v.laneOff = 0;
        v.laneS = v.s;
        v.exitOffset = -r.boxExitS;
        v.exitCoord = v.s + v.exitOffset;
        this.byApproach[r.approach].push(v);
        this.exitGroups[r.exit].push(v);
        if (v.s >= r.stopLineS && v.s - len <= r.boxExitS) this.occupants.push(v);
        if (v.s < r.stopLineS) {
          v.eta = (r.stopLineS - v.s) / Math.max(v.v, ETA_MIN_SPEED);
          v.key = v.eta + (r.movement === 'left' ? LEFT_PENALTY : 0);
          v.sigBlocked = this.signalBlocks(v);
        }
        continue;
      }

      // connector: exit arc -> ring -> entry arc
      if (v.s < r.ringStartS) {
        v.exitOffset = EXIT_REMAINDER;
        v.exitCoord = v.s + EXIT_REMAINDER;
        this.exitGroups[r.exit].push(v);
        if (v.s > r.ringStartS - ARC_TAIL) v.ringU = RING_PATH.uMerge[r.exit] + (v.s - r.ringStartS);
      } else if (v.s <= r.ringEndS) {
        v.ringU = RING_PATH.uMerge[r.exit] + (v.s - r.ringStartS);
      } else {
        v.laneOff = -r.length;
        v.laneS = v.s - r.length;
        this.byApproach[r.approach].push(v);
        if (v.s - r.ringEndS < ARC_HEAD) v.ringU = RING_PATH.uTurn[r.approach] + (v.s - r.ringEndS);
      }
      if (!Number.isNaN(v.ringU)) {
        v.ringU = mod(v.ringU, P);
        this.ring.push(v);
      }
    }

    const byLane = (a: Vehicle, b: Vehicle) => a.laneS - b.laneS || a.id - b.id;
    const byExit = (a: Vehicle, b: Vehicle) => a.exitCoord - b.exitCoord || a.id - b.id;

    for (const a of APPROACHES) {
      const lane = this.byApproach[a];
      lane.sort(byLane);
      for (let i = lane.length - 1; i >= 0; i--) {
        const w = lane[i];
        if (w.route.kind === 'main' && w.s < w.route.stopLineS) {
          this.heads.push(w);
          break;
        }
      }
      // Leader on the shared approach lane (rear of the vehicle ahead is still before the box).
      for (let i = 0; i + 1 < lane.length; i++) {
        const v = lane[i];
        const w = lane[i + 1];
        // Routes from the same arm share their lane until they pull apart: a left-turner waiting in its pocket
        // still blocks the vehicles behind it until it has really swung out of their way.
        const lim = v.route.kind === 'main' && w.route.kind === 'main' ? Math.max(LANE_END, this.network.divergence[v.route.index][w.route.index]) : LANE_END;
        if (v.laneS < lim && w.laneS - len < lim) {
          v.leader = w;
          v.leaderGap = w.laneS - len - v.laneS;
          v.leaderOffset = w.laneOff - v.laneOff;
        }
      }
    }

    // A head stuck behind a waiting left-turner cannot go, so it must not hold up anyone else (this breaks the
    // wait cycle that would otherwise form at an intersection without signals).
    for (const w of this.heads) {
      const row = this.network.conflicts[w.route.index];
      w.pocketBlocked = this.occupants.some(
        (o) => this.isWaiting(o) && o.route.approach !== w.route.approach && o.route.approach !== OPPOSITE[w.route.approach] && row[o.route.index] !== 'none',
      );
    }

    for (const a of APPROACHES) {
      const g = this.exitGroups[a];
      g.sort(byExit);
      for (let i = 0; i < g.length; i++) {
        const v = g[i];
        for (let j = i + 1; j < g.length; j++) {
          const w = g[j];
          // Same-route vehicles always follow each other; merging traffic only once past the merge point.
          if (w.route === v.route || w.exitCoord >= 0) {
            const gap = w.exitCoord - v.exitCoord - len;
            if (gap < v.leaderGap) {
              v.leader = w;
              v.leaderGap = gap;
              v.leaderOffset = w.exitOffset - v.exitOffset;
            }
            break;
          }
        }
      }
    }

    // Do not enter the box when the exit lane beyond it has backed up into it (keeps the junction from locking).
    if (this.circulating) {
      for (const a of APPROACHES) {
        const jammed = this.exitGroups[a].some((w) => w.route.kind === 'main' && w.v < 1.0 && w.s > w.route.boxEnterS && w.exitCoord < 12);
        if (!jammed) continue;
        for (const v of this.vehicles) {
          if (v.route.kind === 'main' && v.route.exit === a && v.s < v.route.stopLineS) v.sigBlocked = true;
        }
      }
    }

    // Ring lane: each vehicle follows the next one clockwise (the loop is cyclic).
    const n = this.ring.length;
    if (n > 1) {
      this.ring.sort((a, b) => a.ringU - b.ringU || a.id - b.id);
      for (let i = 0; i < n; i++) {
        const v = this.ring[i];
        const w = this.ring[(i + 1) % n];
        const diff = mod(w.ringU - v.ringU, P);
        const gap = diff - len;
        if (gap < v.leaderGap) {
          v.leader = w;
          v.leaderGap = gap;
          v.leaderOffset = diff - (w.s - v.s);
        }
      }
    }
  }

  /**
   * Gap acceptance for an exiting vehicle: may it go onto the ring now without cutting anyone off?
   * It compares when this vehicle and each ring vehicle would reach the merge point, and never merges right
   * in front of (or right behind) another vehicle, however slowly that one is moving.
   */
  private canMerge(v: Vehicle): boolean {
    const r = v.route;
    const P = RING_PATH.length;
    const um = RING_PATH.uMerge[r.exit];
    const ringStart = this.connectors[r.exit][v.plannedTarget].ringStartS;
    // Earliest and latest plausible time for this vehicle to reach the merge point (arc speed limit 5 m/s).
    const dist = Math.max(r.length - v.s, 0) + ringStart;
    const tFast = timeToCover(dist, v.v, 1.6, 5.5);
    const tSlow = timeToCover(dist, v.v, 0.8, 4.5) + 0.8;
    const room = this.p.length + this.p.minGap + 1;
    const minBehind = this.p.length + this.p.minGap + 8;
    for (const w of this.ring) {
      const behind = mod(um - w.ringU, P);
      if (behind <= MERGE_UPSTREAM) {
        if (behind < minBehind) return false;
        const tw = behind / Math.max(w.v, 2);
        if (tw > tFast - MERGE_TIME && tw < tSlow + MERGE_TIME) return false;
      }
      if (mod(w.ringU - um, P) < room) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- right of way

  /** A left-turner sitting in its pocket (a little way into the box), waiting for a gap. */
  private isWaiting(w: Vehicle): boolean {
    const r = w.route;
    return r.kind === 'main' && r.movement === 'left' && w.s >= r.stopLineS && w.s <= r.pocketS + POCKET_SLACK && w.v < 1.0;
  }

  /**
   * Is `v` held back by right-of-way?
   *
   * Left-turners work in two steps. To *enter* the box (asPocket = false) they only have to keep clear of
   * what actually conflicts with their pocket: oncoming through traffic passes 3.5 m away, so it does not
   * stop them. To *leave* the pocket and finish the turn (asPocket = true) they need a gap in oncoming
   * traffic, exactly like a permissive left. A waiting left-turner has no priority over oncoming traffic,
   * and two oncoming left-turners never share the box (their paths cross), so the lower id keeps the pocket.
   * At the end of green the oncoming vehicles that can stop do so, and the waiting left-turner clears the box.
   */
  private conflictBlocked(v: Vehicle, asPocket: boolean): boolean {
    const r = v.route;
    const row = this.network.conflicts[r.index];
    const left = r.movement === 'left';
    const opposite = OPPOSITE[r.approach];
    const myKey = asPocket ? LEFT_PENALTY : v.key;
    const myEta = asPocket ? 0 : v.eta;

    // 1. Anything already committed to the box has priority.
    for (const w of this.occupants) {
      if (w === v) continue;
      const kind = row[w.route.index];
      if (kind === 'none') continue;
      const opposing = w.route.approach === opposite;
      if (left && !asPocket && opposing && w.route.movement !== 'left') continue; // oncoming through traffic misses the pocket
      if (opposing && this.isWaiting(w)) {
        if (left && w.route.movement === 'left' && (!asPocket || w.id < v.id)) return true; // one left-turner at a time
        continue; // oncoming traffic does not give way to a waiting left-turner
      }
      if (kind === 'crossing') return true;
      if (w.s < w.route.boxExitS) return true; // merging, and w has not yet reached the merge point
    }

    // 2. Competing queue heads: total order by (estimated arrival + left-turn penalty, id).
    for (const w of this.heads) {
      if (w === v || w.route.approach === r.approach) continue;
      const kind = row[w.route.index];
      if (kind === 'none' || w.pocketBlocked) continue;
      // A left-turner leaving its pocket only trusts an oncoming car to stop if it can do so comfortably.
      if (w.sigBlocked && (!asPocket || (w.v * w.v) / (2 * this.p.comfortDecel) <= w.route.stopLineS - w.s)) continue;
      if (asPocket) {
        // already in the box: queue heads give way to it, so it only has to wait for a gap in oncoming traffic
        if (w.route.approach !== opposite || w.route.movement === 'left') continue;
      } else if (left && w.route.approach === opposite && w.route.movement !== 'left') {
        continue; // entering: oncoming through traffic does not matter
      }
      const wins = w.key < myKey || (w.key === myKey && w.id < v.id);
      if (!wins) continue;
      if (kind === 'merging' && Math.abs(w.eta - myEta) >= MERGE_WINDOW) continue;
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- dynamics

  private idm(speed: number, v0: number, gap: number, leaderSpeed: number): number {
    const { maxAccel: a, comfortDecel: b, timeHeadway: T, minGap: s0 } = this.p;
    const r = speed / v0;
    const free = a * (1 - r * r * r * r);
    if (gap === Infinity) return free;
    const sStar = s0 + Math.max(0, speed * T + (speed * (speed - leaderSpeed)) / (2 * Math.sqrt(a * b)));
    const g = Math.max(gap, 0.1);
    return free - a * (sStar / g) * (sStar / g);
  }

  /** Lowest speed limit ahead (turns, ring corners), looking into the next leg in circulating mode. */
  private allowedSpeed(v: Vehicle): number {
    const b = this.p.comfortDecel;
    let lim = Infinity;
    const apply = (r: Route, pos: number) => {
      for (const seg of r.limits) {
        if (pos > seg.s1) continue;
        const allowed = pos >= seg.s0 ? seg.speed : Math.sqrt(seg.speed * seg.speed + 2 * b * (seg.s0 - pos));
        if (allowed < lim) lim = allowed;
      }
    };
    const r = v.route;
    apply(r, v.s);
    if (this.circulating) {
      const next = r.kind === 'main' ? this.connectors[r.exit][v.plannedTarget] : this.mains[r.approach][v.plannedMovement];
      apply(next, v.s - r.length);
    }
    return lim;
  }

  private computeAccelerations(): void {
    const p = this.p;
    for (const v of this.vehicles) {
      const route = v.route;
      const v0 = Math.min(v.desiredSpeed, this.allowedSpeed(v));
      let acc = this.idm(v.v, v0, v.leaderGap, v.leader ? v.leader.v : 0);

      if (route.kind === 'main') {
        if (v.s < route.stopLineS && (v.sigBlocked || this.conflictBlocked(v, false))) {
          v.held = true;
          // Virtual stopped vehicle placed so the held vehicle halts STOP_MARGIN short of the stop line.
          const gap = route.stopLineS - STOP_MARGIN + p.minGap - v.s;
          acc = Math.min(acc, this.idm(v.v, v0, gap, 0));
        } else if (route.movement === 'left' && (v.s < route.pocketS + 0.3 || (v.v < 1.5 && v.s < route.pocketS + POCKET_SLACK)) && this.conflictBlocked(v, true)) {
          // A left-turner may pull into the box, but waits in its pocket until there is a gap.
          v.held = true;
          const gap = route.pocketS - STOP_MARGIN + p.minGap - v.s;
          acc = Math.min(acc, this.idm(v.v, v0, gap, 0));
        } else if (this.circulating && route.length - v.s < YIELD_LOOKAHEAD && !this.canMerge(v)) {
          // Give way to ring traffic at the end of the arm.
          v.held = true;
          const gap = route.length - STOP_MARGIN + p.minGap - v.s;
          acc = Math.min(acc, this.idm(v.v, v0, gap, 0));
        }
      }

      const target = Math.max(-p.maxDecel, Math.min(p.maxAccel, acc));
      // Acceleration smoothing (jerk limit).
      const dA = Math.max(-p.maxJerkDown * this.config.dt, Math.min(p.maxJerkUp * this.config.dt, target - v.a));
      v.nextA = v.a + dA;
    }
  }

  private integrate(dt: number, tNew: number): void {
    const p = this.p;

    for (const v of this.vehicles) {
      const a = v.nextA;
      const vFree = v.v + a * dt;
      if (vFree < 0) {
        v.nextV = 0;
        v.nextS = v.s + (a < 0 ? (v.v * v.v) / (2 * -a) : 0);
      } else {
        v.nextV = vFree;
        v.nextS = v.s + ((v.v + vFree) / 2) * dt;
      }
    }

    // Hard guard against overlap with the leader (synchronous update, so compare new states).
    for (const v of this.vehicles) {
      const w = v.leader;
      if (!w) continue;
      const gapNew = w.nextS + v.leaderOffset - p.length - v.nextS;
      if (gapNew < HARD_MIN_GAP) {
        v.nextS = Math.max(v.s, w.nextS + v.leaderOffset - p.length - HARD_MIN_GAP);
        v.nextV = Math.min(v.nextV, w.nextV);
        this._stats.safetyClamps++;
        if (this._clampSamples.length < 40) {
          this._clampSamples.push(`t=${tNew.toFixed(2)} ${v.route.id}#${v.id} s=${v.s.toFixed(1)} v=${v.v.toFixed(1)} -> leader ${w.route.id}#${w.id} s=${w.s.toFixed(1)} v=${w.v.toFixed(1)} gapNew=${gapNew.toFixed(2)} held=${v.held}`);
        }
      } else if (gapNew < this._stats.minGap) {
        this._stats.minGap = gapNew;
      }
    }

    const st = this._stats;
    const survivors: Vehicle[] = [];
    for (const v of this.vehicles) {
      const oldS = v.s;
      v.s = v.nextS;
      v.v = v.nextV;
      v.a = v.nextA;

      if (v.v > st.maxSpeed) st.maxSpeed = v.v;
      if (v.a > st.maxAccel) st.maxAccel = v.a;
      if (-v.a > st.maxDecel) st.maxDecel = -v.a;

      const r = v.route;
      if (r.kind === 'main') {
        // waiting counts until the vehicle is really through: a left-turner sitting in its pocket is still waiting
        if (v.s < (r.movement === 'left' ? r.pocketS + POCKET_SLACK : r.stopLineS) && v.v < 0.5) v.waitingTime += dt;
        if (v.v < 0.1) v.stoppedTime += dt;

        if (oldS < r.stopLineS && v.s >= r.stopLineS) {
          v.stopLineTime = tNew;
          st.enteredIntersection++;
          st.perApproach[r.approach].enteredIntersection++;
          if (this.signalStates[r.approach] === 'red') {
            v.ranRed = true;
            st.redLightEntries++;
          }
        }

        if (v.s >= r.length) {
          st.exited++;
          st.perApproach[r.approach].exited++;
          this._completed.push({
            id: v.id,
            approach: r.approach,
            movement: r.movement,
            generatedAt: v.generatedAt,
            insertedAt: v.insertedAt,
            stopLineTime: v.stopLineTime,
            exitedAt: tNew,
            waitingTime: v.waitingTime,
            stoppedTime: v.stoppedTime,
            ranRed: v.ranRed,
          });
          if (this.circulating) {
            // Leave through the arm and join the ring: the same vehicle carries on, nothing is removed.
            v.s -= r.length;
            v.route = this.connectors[r.exit][v.plannedTarget];
            survivors.push(v);
          }
        } else {
          survivors.push(v);
        }
      } else {
        if (v.v < 0.1) v.stoppedTime += dt;
        if (v.s >= r.length) {
          // Back into an arm: start a fresh leg on the entry lane.
          v.s -= r.length;
          v.route = this.mains[r.approach][v.plannedMovement];
          v.legs++;
          v.generatedAt = tNew;
          v.insertedAt = tNew;
          v.stopLineTime = -1;
          v.waitingTime = 0;
          v.stoppedTime = 0;
          v.ranRed = false;
          this.samplePlan(v);
        }
        survivors.push(v);
      }
    }
    this.vehicles = survivors;
  }

  /** Diagnostics: any two vehicle bodies overlapping anywhere on the network. */
  private checkOverlaps(t: number): void {
    const p = this.p;
    const poses = this.vehicles.map((v) => poseAt(v.route, v.s - p.length / 2));
    const cells = new Map<number, number[]>();
    const key = (cx: number, cy: number) => cx * 100003 + cy;
    poses.forEach((pose, i) => {
      const k = key(Math.floor(pose.x / GRID), Math.floor(pose.y / GRID));
      const list = cells.get(k);
      if (list) list.push(i);
      else cells.set(k, [i]);
    });
    poses.forEach((pose, i) => {
      const cx = Math.floor(pose.x / GRID);
      const cy = Math.floor(pose.y / GRID);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const list = cells.get(key(cx + dx, cy + dy));
          if (!list) continue;
          for (const j of list) {
            if (j <= i) continue;
            if (Math.hypot(poses[j].x - pose.x, poses[j].y - pose.y) > p.length + 1) continue;
            if (obbOverlap(pose, poses[j], p.length, p.width)) {
              this._stats.overlapPairSteps++;
              this._stats.firstOverlap ??= { time: t, a: this.vehicles[i].id, b: this.vehicles[j].id };
            }
          }
        }
      }
    });
  }
}
