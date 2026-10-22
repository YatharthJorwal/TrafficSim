import { OPPOSITE } from '../sim/network';
import { APPROACHES, type Approach, type SignalStates } from '../sim/types';
import type { PhaseDef, SignalTiming } from './types';

/** Two approaches conflict unless they are the same arm or directly opposite each other. */
export function approachesConflict(a: Approach, b: Approach): boolean {
  return a !== b && OPPOSITE[a] !== b;
}

/** Pairs of conflicting approaches that are both showing a non-red signal. Must always be empty. */
export function conflictingGreens(colors: SignalStates): [Approach, Approach][] {
  const out: [Approach, Approach][] = [];
  for (let i = 0; i < APPROACHES.length; i++) {
    for (let j = i + 1; j < APPROACHES.length; j++) {
      const a = APPROACHES[i];
      const b = APPROACHES[j];
      if (colors[a] !== 'red' && colors[b] !== 'red' && approachesConflict(a, b)) out.push([a, b]);
    }
  }
  return out;
}

/** North-South and East-West, each phase serving both directions of one road. */
export const TWO_PHASE_PLAN: readonly PhaseDef[] = [
  { id: 'NS', label: 'North-South', greens: ['N', 'S'] },
  { id: 'EW', label: 'East-West', greens: ['E', 'W'] },
];

export const DEFAULT_TIMING: SignalTiming = { yellow: 3, allRed: 2, minGreen: 7, maxGreen: 60 };

export function validatePhases(phases: readonly PhaseDef[]): string[] {
  const e: string[] = [];
  if (phases.length < 1) e.push('at least one phase is required');
  const ids = new Set<string>();
  const served = new Set<Approach>();
  for (const p of phases) {
    if (ids.has(p.id)) e.push(`duplicate phase id "${p.id}"`);
    ids.add(p.id);
    if (p.greens.length === 0) e.push(`phase "${p.id}" has no green approaches`);
    for (let i = 0; i < p.greens.length; i++) {
      served.add(p.greens[i]);
      for (let j = i + 1; j < p.greens.length; j++) {
        if (approachesConflict(p.greens[i], p.greens[j]))
          e.push(`phase "${p.id}" gives green to conflicting approaches ${p.greens[i]} and ${p.greens[j]}`);
      }
    }
  }
  for (const a of APPROACHES) if (!served.has(a)) e.push(`approach ${a} is never served by any phase`);
  return e;
}

export function validateTiming(t: SignalTiming): string[] {
  const e: string[] = [];
  const ok = (n: number) => Number.isFinite(n);
  if (!ok(t.yellow) || t.yellow < 3 || t.yellow > 6) e.push('yellow must be between 3 and 6 s');
  if (!ok(t.allRed) || t.allRed < 1 || t.allRed > 10) e.push('allRed must be between 1 and 10 s');
  if (!ok(t.minGreen) || t.minGreen < 5) e.push('minGreen must be at least 5 s');
  if (!ok(t.maxGreen) || t.maxGreen < t.minGreen) e.push('maxGreen must be >= minGreen');
  if (ok(t.maxGreen) && t.maxGreen > 180) e.push('maxGreen must be <= 180 s');
  return e;
}
