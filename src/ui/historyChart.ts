import type { HistorySample } from '../runtime';
import { APPROACHES, type Approach } from '../sim/types';
import type { LinePoint } from './charts/LineChart';

/** Queue per approach over time, as chart points. */
export function queueSeries(samples: readonly HistorySample[]): Record<Approach, LinePoint[]> {
  const out = { N: [], E: [], S: [], W: [] } as Record<Approach, LinePoint[]>;
  for (const a of APPROACHES) out[a] = samples.map((s) => ({ x: s.t, y: s.queue[a] }));
  return out;
}

/**
 * Stretches of time during which `phase` showed green (not yellow or all-red), as [start, end] pairs.
 * A stretch ends at the last green sample, so the strip never claims green beyond what was recorded.
 */
export function greenSpans(samples: readonly HistorySample[], phase: string): [number, number][] {
  const spans: [number, number][] = [];
  let start: number | null = null;
  let last = 0;
  for (const s of samples) {
    const on = s.phase === phase && s.stage === 'green';
    if (on && start === null) start = s.t;
    if (!on && start !== null) {
      spans.push([start, last]);
      start = null;
    }
    if (on) last = s.t;
  }
  if (start !== null) spans.push([start, last]);
  return spans;
}
