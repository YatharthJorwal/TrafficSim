import { describe, expect, it } from 'vitest';
import type { HistorySample } from '../runtime';
import { greenSpans, queueSeries } from './historyChart';

const s = (t: number, phase: string, stage: HistorySample['stage'], n = 0): HistorySample => ({ t, phase, stage, queue: { N: n, E: n + 1, S: n + 2, W: n + 3 } });

describe('history chart data', () => {
  it('turns samples into one point list per approach', () => {
    const q = queueSeries([s(1, 'NS', 'green', 2), s(2, 'NS', 'green', 5)]);
    expect(q.N).toEqual([{ x: 1, y: 2 }, { x: 2, y: 5 }]);
    expect(q.W).toEqual([{ x: 1, y: 5 }, { x: 2, y: 8 }]);
    expect(queueSeries([]).E).toEqual([]);
  });

  it('finds green stretches, ending each at the last green sample', () => {
    const samples = [s(1, 'NS', 'green'), s(2, 'NS', 'green'), s(3, 'NS', 'yellow'), s(4, 'NS', 'allRed'), s(5, 'EW', 'green'), s(6, 'EW', 'green'), s(7, 'NS', 'green')];
    expect(greenSpans(samples, 'NS')).toEqual([[1, 2], [7, 7]]);
    expect(greenSpans(samples, 'EW')).toEqual([[5, 6]]);
    expect(greenSpans([], 'NS')).toEqual([]);
  });

  it('does not count yellow as green', () => {
    expect(greenSpans([s(1, 'NS', 'yellow'), s(2, 'NS', 'yellow')], 'NS')).toEqual([]);
  });
});
