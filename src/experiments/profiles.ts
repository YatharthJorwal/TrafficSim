import type { PhaseDef, PhaseId } from '../control/types';
import { createConfig } from '../sim/config';
import { deriveSeed } from '../sim/rng';
import { generateSchedule } from '../sim/schedule';
import { APPROACHES, type Approach, type Arrival, type SimConfig, type TurnMix } from '../sim/types';

/** One stretch of constant demand. It lasts from `startFraction` of the run to the next segment (or the end). */
export interface DemandSegment {
  startFraction: number;
  /** Mean arrival rate per approach, veh/h (Poisson). */
  rates: Record<Approach, number>;
}

export interface DemandProfile {
  id: string;
  label: string;
  description: string;
  turnMix: TurnMix;
  segments: readonly DemandSegment[];
}

const MIX: TurnMix = { left: 0.2, straight: 0.6, right: 0.2 };
const rates = (ns: number, ew: number): Record<Approach, number> => ({ N: ns, S: ns, E: ew, W: ew });
const steady = (ns: number, ew: number): readonly DemandSegment[] => [{ startFraction: 0, rates: rates(ns, ew) }];

/**
 * Demand profiles. Capacity of the junction under a 60 s fixed plan with 20 % left turns is about
 * 1000-1100 veh/h in total (see docs/HANDOFF.md), so "balanced" sits right at it and "heavy" is well past it.
 * Rates are the ones used in the M4 preview so the numbers stay comparable.
 */
export const PROFILES: readonly DemandProfile[] = [
  { id: 'light', label: 'Light', description: '120 veh/h per approach (480 total, under half of capacity)', turnMix: MIX, segments: steady(120, 120) },
  { id: 'balanced', label: 'Balanced', description: '250 veh/h per approach (1000 total, about at capacity)', turnMix: MIX, segments: steady(250, 250) },
  { id: 'uneven', label: 'Uneven', description: 'N/S 450, E/W 100 veh/h per approach (1100 total, directional)', turnMix: MIX, segments: steady(450, 100) },
  { id: 'heavy', label: 'Heavy', description: '400 veh/h per approach (1600 total, over capacity)', turnMix: MIX, segments: steady(400, 400) },
  {
    id: 'shifting',
    label: 'Shifting',
    description: 'N/S 450 and E/W 100 for the first half, then N/S 100 and E/W 450 (1100 total, the dominant road changes)',
    turnMix: MIX,
    segments: [
      { startFraction: 0, rates: rates(450, 100) },
      { startFraction: 0.5, rates: rates(100, 450) },
    ],
  },
];

export function profileById(id: string): DemandProfile {
  const p = PROFILES.find((x) => x.id === id);
  if (!p) throw new Error(`unknown demand profile "${id}" (known: ${PROFILES.map((x) => x.id).join(', ')})`);
  return p;
}

export function validateProfile(p: DemandProfile): string[] {
  const e: string[] = [];
  if (p.segments.length === 0) e.push('a profile needs at least one segment');
  if (p.segments[0] && p.segments[0].startFraction !== 0) e.push('the first segment must start at 0');
  p.segments.forEach((s, i) => {
    if (!(s.startFraction >= 0 && s.startFraction < 1)) e.push(`segment ${i}: startFraction must be in [0, 1)`);
    if (i > 0 && s.startFraction <= p.segments[i - 1].startFraction) e.push(`segment ${i}: startFraction must increase`);
    for (const a of APPROACHES) if (!(s.rates[a] >= 0) || !Number.isFinite(s.rates[a])) e.push(`segment ${i}: rate for ${a} must be a non-negative number`);
  });
  return e;
}

function segmentBounds(p: DemandProfile, duration: number): { start: number; end: number; rates: Record<Approach, number> }[] {
  return p.segments.map((s, i) => ({
    start: s.startFraction * duration,
    end: (p.segments[i + 1]?.startFraction ?? 1) * duration,
    rates: s.rates,
  }));
}

/** Time-weighted mean rate per approach over the whole run (veh/h). */
export function averageRates(p: DemandProfile): Record<Approach, number> {
  const out: Record<Approach, number> = { N: 0, E: 0, S: 0, W: 0 };
  p.segments.forEach((s, i) => {
    const w = (p.segments[i + 1]?.startFraction ?? 1) - s.startFraction;
    for (const a of APPROACHES) out[a] += s.rates[a] * w;
  });
  return out;
}

/** Mean demand of the busiest approach of each phase (veh/h): the critical flow a fixed plan can be tuned to. */
export function criticalFlowByPhase(p: DemandProfile, phases: readonly PhaseDef[]): Record<PhaseId, number> {
  const avg = averageRates(p);
  const out: Record<PhaseId, number> = {};
  for (const ph of phases) out[ph.id] = Math.max(...ph.greens.map((a) => avg[a]));
  return out;
}

/**
 * Arrival schedule for a profile and seed. A profile with one segment gives exactly `generateSchedule` of the
 * equivalent config, so constant profiles match the rest of the project. Later segments draw from their own seeds
 * (Poisson arrivals are memoryless, so restarting the stream at a boundary does not bias the process).
 * The result depends only on (profile, seed, duration): never on a controller.
 */
export function buildSchedule(p: DemandProfile, seed: number, duration: number): Arrival[] {
  const issues = validateProfile(p);
  if (issues.length) throw new Error(`invalid demand profile "${p.id}":\n - ${issues.join('\n - ')}`);
  const all: Omit<Arrival, 'id'>[] = [];
  segmentBounds(p, duration).forEach((seg, i) => {
    const config = createConfig({ seed: i === 0 ? seed : deriveSeed(seed, 7000 + i), duration: seg.end - seg.start });
    for (const a of APPROACHES) config.demand[a] = { ratePerHour: seg.rates[a], turnMix: { ...p.turnMix } };
    for (const arr of generateSchedule(config)) {
      const { id: _id, ...rest } = arr;
      all.push({ ...rest, time: rest.time + seg.start });
    }
  });
  all.sort((x, y) => x.time - y.time || APPROACHES.indexOf(x.approach) - APPROACHES.indexOf(y.approach));
  return all.map((d, i) => ({ id: i + 1, ...d }));
}

/** A config for the engine that matches the profile (arrivals mode). The schedule is passed separately. */
export function profileConfig(p: DemandProfile, seed: number, duration: number): SimConfig {
  const avg = averageRates(p);
  const config = createConfig({ seed, duration });
  for (const a of APPROACHES) config.demand[a] = { ratePerHour: avg[a], turnMix: { ...p.turnMix } };
  return config;
}

/** Short stable fingerprint of a schedule (FNV-1a over times, approaches and movements). For reproducibility records. */
export function scheduleChecksum(schedule: readonly Arrival[]): string {
  let h = 0x811c9dc5;
  const mix = (n: number) => {
    h ^= n & 0xffffffff;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (const a of schedule) {
    mix(Math.round(a.time * 1000));
    mix(APPROACHES.indexOf(a.approach));
    mix(a.movement === 'left' ? 0 : a.movement === 'straight' ? 1 : 2);
    mix(Math.round(a.speedFactor * 1e6));
  }
  return `${schedule.length}:${h.toString(16).padStart(8, '0')}`;
}
