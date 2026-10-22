import { assertValidConfig } from './config';
import { obbOverlap } from './collision';
import { NETWORK, poseAt, type Network, type Route } from './network';
import { generateSchedule } from './schedule';
import {
  APPROACHES,
  type Approach,
  type Arrival,
  type ApproachCounts,
  type EngineStats,
  type Movement,
  type SignalStates,
  type SimConfig,
  type SimSnapshot,
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
/** Hard anti-overlap guard threshold (m). */
const HARD_MIN_GAP = 0.1;
const DIAGNOSTIC_RADIUS = 16;
/** Held vehicles aim to stop this far short of the stop line, so numerical creep never crosses it (m). */
const STOP_MARGIN = 0.5;

interface Vehicle {
  id: number;
  route: Route;
  approach: Approach;
  movement: Movement;
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
  // per-step scratch
  exitCoord: number;
  eta: number;
  key: number;
  sigBlocked: boolean;
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
 * - No randomness at run time: all arrivals (and per-vehicle speed factors) come from the schedule.
 * - Signal states are *inputs* (setSignals); the engine never decides them.
 * - The renderer reads snapshot(); it is never the source of truth.
 */
export class SimulationEngine {
  readonly config: SimConfig;
  readonly network: Network = NETWORK;
  readonly schedule: readonly Arrival[];

  private readonly p: VehicleParams;
  private readonly diagnostics: boolean;
  private signalStates: SignalStates;

  private vehicles: Vehicle[] = [];
  private stepCount = 0;
  private nextArrival = 0;
  private backlog: Record<Approach, Arrival[]> = { N: [], E: [], S: [], W: [] };
  private _stats: EngineStats = newStats();
  private _completed: VehicleRecord[] = [];

  private byApproach: Record<Approach, Vehicle[]> = { N: [], E: [], S: [], W: [] };
  private exitGroups: Record<Approach, Vehicle[]> = { N: [], E: [], S: [], W: [] };
  private heads: Vehicle[] = [];
  private occupants: Vehicle[] = [];

  constructor(config: SimConfig, options: EngineOptions = {}) {
    assertValidConfig(config);
    this.config = JSON.parse(JSON.stringify(config)) as SimConfig;
    this.p = this.config.vehicle;
    this.schedule = options.schedule ?? generateSchedule(this.config);
    this.diagnostics = options.diagnostics ?? false;
    this.signalStates = options.signals ? { ...options.signals } : allGreen();
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
  get vehiclesOnNetwork(): number {
    return this.vehicles.length;
  }
  get signals(): Readonly<SignalStates> {
    return this.signalStates;
  }

  /** Vehicles generated but not yet placed on the road because the entry was occupied. */
  backlogCount(approach: Approach): number {
    return this.backlog[approach].length;
  }

  setSignals(states: SignalStates): void {
    this.signalStates = { ...states };
  }

  /** Restart from t = 0 with the same config and schedule. Signals are left untouched. */
  reset(): void {
    this.vehicles = [];
    this.stepCount = 0;
    this.nextArrival = 0;
    this.backlog = { N: [], E: [], S: [], W: [] };
    this._stats = newStats();
    this._completed = [];
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
    this.prepare();
    this.computeAccelerations();
    this.integrate(dt, t + dt);
    if (this.diagnostics) this.checkOverlaps(t + dt);
    this.stepCount++;
  }

  snapshot(): SimSnapshot {
    return {
      time: this.time,
      signals: { ...this.signalStates },
      vehicles: this.vehicles.map((v) => {
        const pose = poseAt(v.route, v.s - this.p.length / 2);
        return {
          id: v.id,
          approach: v.approach,
          movement: v.movement,
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
    const parts = this.vehicles.map((v) => `${v.id}:${v.s}:${v.v}:${v.a}`);
    const st = this._stats;
    return `${this.stepCount}|${st.generated},${st.inserted},${st.enteredIntersection},${st.exited}|${parts.join(';')}`;
  }

  // ---------------------------------------------------------------- arrivals

  private releaseArrivals(t: number): void {
    while (this.nextArrival < this.schedule.length && this.schedule[this.nextArrival].time <= t) {
      const arr = this.schedule[this.nextArrival++];
      this.backlog[arr.approach].push(arr);
      this._stats.generated++;
      this._stats.perApproach[arr.approach].generated++;
    }
  }

  private insertFromBacklog(t: number): void {
    const p = this.p;
    for (const approach of APPROACHES) {
      const queue = this.backlog[approach];
      if (queue.length === 0) continue;
      const arr = queue[0];

      // Rearmost vehicle that came from this approach is the one the new vehicle would follow.
      let rear: Vehicle | null = null;
      for (const v of this.vehicles) {
        if (v.approach === approach && (rear === null || v.s < rear.s)) rear = v;
      }
      const desired = p.freeSpeed * arr.speedFactor;
      let vInit = desired;
      if (rear) {
        const gap = rear.s - p.length; // new vehicle front is at s = 0
        if (gap < p.minGap + 1) continue;
        const safe = Math.sqrt(rear.v * rear.v + 2 * p.comfortDecel * Math.max(0, gap - p.minGap));
        vInit = Math.min(desired, safe);
      }

      queue.shift();
      const route = this.network.route(arr.approach, arr.movement);
      this.vehicles.push({
        id: arr.id,
        route,
        approach: arr.approach,
        movement: arr.movement,
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
        exitCoord: 0,
        eta: 0,
        key: Infinity,
        sigBlocked: false,
        held: false,
        leader: null,
        leaderGap: Infinity,
        leaderOffset: 0,
        nextS: 0,
        nextV: 0,
        nextA: 0,
      });
      this._stats.inserted++;
      this._stats.perApproach[approach].inserted++;
    }
  }

  // ---------------------------------------------------------------- per-step indices

  private signalBlocks(v: Vehicle): boolean {
    const color = this.signalStates[v.approach];
    if (color === 'green') return false;
    const dist = v.route.stopLineS - v.s;
    if (color === 'yellow') return (v.v * v.v) / (2 * YELLOW_STOP_DECEL) <= dist;
    // Red: stop if physically possible; otherwise the vehicle is committed and counted as a red entry.
    return (v.v * v.v) / (2 * this.p.maxDecel) <= dist + 0.5;
  }

  private prepare(): void {
    const len = this.p.length;
    for (const a of APPROACHES) {
      this.byApproach[a].length = 0;
      this.exitGroups[a].length = 0;
    }
    this.heads.length = 0;
    this.occupants.length = 0;

    for (const v of this.vehicles) {
      v.exitCoord = v.s - v.route.boxExitS;
      v.leader = null;
      v.leaderGap = Infinity;
      v.leaderOffset = 0;
      v.held = false;
      v.sigBlocked = false;
      this.byApproach[v.approach].push(v);
      this.exitGroups[v.route.exit].push(v);
      if (v.s >= v.route.stopLineS && v.s - len <= v.route.boxExitS) this.occupants.push(v);
      if (v.s < v.route.stopLineS) {
        v.eta = (v.route.stopLineS - v.s) / Math.max(v.v, ETA_MIN_SPEED);
        v.key = v.eta + (v.movement === 'left' ? LEFT_PENALTY : 0);
        v.sigBlocked = this.signalBlocks(v);
      }
    }

    const byS = (a: Vehicle, b: Vehicle) => a.s - b.s || a.id - b.id;
    const byExit = (a: Vehicle, b: Vehicle) => a.exitCoord - b.exitCoord || a.id - b.id;

    for (const a of APPROACHES) {
      const lane = this.byApproach[a];
      lane.sort(byS);
      for (let i = lane.length - 1; i >= 0; i--) {
        if (lane[i].s < lane[i].route.stopLineS) {
          this.heads.push(lane[i]);
          break;
        }
      }
      // Leader on the shared approach lane (rear of the vehicle ahead is still before the box).
      for (let i = 0; i + 1 < lane.length; i++) {
        const v = lane[i];
        const w = lane[i + 1];
        if (v.s < v.route.boxEnterS && w.s - len < v.route.boxEnterS) {
          v.leader = w;
          v.leaderGap = w.s - len - v.s;
          v.leaderOffset = 0;
        }
      }
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
              v.leaderOffset = v.route.boxExitS - w.route.boxExitS;
            }
            break;
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- right of way

  private conflictBlocked(v: Vehicle): boolean {
    const row = this.network.conflicts[v.route.index];

    // 1. Anything already committed to the box has absolute priority.
    for (const w of this.occupants) {
      const kind = row[w.route.index];
      if (kind === 'none') continue;
      if (kind === 'crossing') return true;
      if (w.s < w.route.boxExitS) return true; // merging, and w has not yet reached the merge point
    }

    // 2. Competing queue heads: total order by (estimated arrival + left-turn penalty, id).
    for (const w of this.heads) {
      if (w === v || w.approach === v.approach) continue;
      const kind = row[w.route.index];
      if (kind === 'none' || w.sigBlocked) continue;
      const wins = w.key < v.key || (w.key === v.key && w.id < v.id);
      if (!wins) continue;
      if (kind === 'merging' && Math.abs(w.eta - v.eta) >= MERGE_WINDOW) continue;
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

  private computeAccelerations(): void {
    const p = this.p;
    for (const v of this.vehicles) {
      const route = v.route;

      // Free-flow target, reduced ahead of / inside a turn.
      let v0 = v.desiredSpeed;
      if (route.turnSpeed !== Infinity && v.s < route.boxExitS) {
        const allowed =
          v.s < route.boxEnterS
            ? Math.sqrt(route.turnSpeed * route.turnSpeed + 2 * p.comfortDecel * (route.boxEnterS - v.s))
            : route.turnSpeed;
        v0 = Math.min(v0, allowed);
      }

      let acc = this.idm(v.v, v0, v.leaderGap, v.leader ? v.leader.v : 0);

      if (v.s < route.stopLineS && (v.sigBlocked || this.conflictBlocked(v))) {
        v.held = true;
        // Virtual stopped vehicle placed so the held vehicle halts STOP_MARGIN short of the stop line.
        const gap = route.stopLineS - STOP_MARGIN + p.minGap - v.s;
        acc = Math.min(acc, this.idm(v.v, v0, gap, 0));
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

      if (v.s < v.route.stopLineS && v.v < 0.5) v.waitingTime += dt;
      if (v.v < 0.1) v.stoppedTime += dt;

      if (oldS < v.route.stopLineS && v.s >= v.route.stopLineS) {
        v.stopLineTime = tNew;
        st.enteredIntersection++;
        st.perApproach[v.approach].enteredIntersection++;
        if (this.signalStates[v.approach] === 'red') {
          v.ranRed = true;
          st.redLightEntries++;
        }
      }

      if (v.s >= v.route.length) {
        st.exited++;
        st.perApproach[v.approach].exited++;
        this._completed.push({
          id: v.id,
          approach: v.approach,
          movement: v.movement,
          generatedAt: v.generatedAt,
          insertedAt: v.insertedAt,
          stopLineTime: v.stopLineTime,
          exitedAt: tNew,
          waitingTime: v.waitingTime,
          stoppedTime: v.stoppedTime,
          ranRed: v.ranRed,
        });
      } else {
        survivors.push(v);
      }
    }
    this.vehicles = survivors;
  }

  private checkOverlaps(t: number): void {
    const p = this.p;
    const near = this.vehicles.filter(
      (v) => v.s >= v.route.boxEnterS - 10 && v.s - p.length <= v.route.boxExitS + 10,
    );
    const poses = near.map((v) => poseAt(v.route, v.s - p.length / 2));
    for (let i = 0; i < near.length; i++) {
      if (Math.hypot(poses[i].x, poses[i].y) > DIAGNOSTIC_RADIUS) continue;
      for (let j = i + 1; j < near.length; j++) {
        if (Math.hypot(poses[j].x, poses[j].y) > DIAGNOSTIC_RADIUS) continue;
        if (obbOverlap(poses[i], poses[j], p.length, p.width)) {
          this._stats.overlapPairSteps++;
          this._stats.firstOverlap ??= { time: t, a: near[i].id, b: near[j].id };
        }
      }
    }
  }
}

