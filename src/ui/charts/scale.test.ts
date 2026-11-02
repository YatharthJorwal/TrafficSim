import { describe, expect, it } from 'vitest';
import { formatClock, formatNumber, formatSigned, linear, nearestIndex, niceCeil, niceTicks, thin } from './scale';

describe('chart scale helpers', () => {
  it('picks round ticks that cover the range', () => {
    expect(niceTicks(0, 100)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(0, 7)).toEqual([0, 2, 4, 6]);
    expect(niceTicks(3, 3)[0]).toBeLessThanOrEqual(3);
    expect(niceTicks(0, 0)).toEqual([0, 1]);
    expect(niceTicks(10, 0)).toEqual(niceTicks(0, 10));
    expect(niceTicks(NaN, 5)).toEqual([0]);
  });

  it('never returns floating point noise in ticks', () => {
    for (const t of niceTicks(0, 0.7)) expect(String(t).length).toBeLessThan(6);
  });

  it('rounds an axis end up to a round value', () => {
    expect(niceCeil(43)).toBe(50);
    expect(niceCeil(101)).toBe(200);
    expect(niceCeil(2.3)).toBe(2.5);
    expect(niceCeil(0)).toBe(1);
  });

  it('maps linearly and survives a zero-width domain', () => {
    const f = linear(0, 10, 100, 200);
    expect(f(0)).toBe(100);
    expect(f(5)).toBe(150);
    expect(Number.isFinite(linear(4, 4, 0, 10)(4))).toBe(true);
  });

  it('finds the nearest sample for hover hit-testing', () => {
    const xs = [0, 10, 20, 30];
    expect(nearestIndex(xs, -5)).toBe(0);
    expect(nearestIndex(xs, 4)).toBe(0);
    expect(nearestIndex(xs, 6)).toBe(1);
    expect(nearestIndex(xs, 15)).toBe(1); // ties go to the earlier sample
    expect(nearestIndex(xs, 99)).toBe(3);
    expect(nearestIndex([], 1)).toBe(-1);
  });

  it('formats numbers without needless decimals', () => {
    expect(formatNumber(12)).toBe('12');
    expect(formatNumber(2.5)).toBe('2.5');
    expect(formatNumber(2.54, 2)).toBe('2.54');
    expect(formatNumber(12345)).toBe('12.3K');
    expect(formatNumber(NaN)).toBe('n/a');
    expect(formatSigned(3)).toBe('+3');
    expect(formatSigned(-3)).toBe('-3');
    expect(formatSigned(0)).toBe('0');
  });

  it('formats simulated time as m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(1800)).toBe('30:00');
    expect(formatClock(-4)).toBe('0:00');
  });

  it('thins a long list, keeping the first and last', () => {
    const xs = Array.from({ length: 100 }, (_, i) => i);
    const t = thin(xs, 10);
    expect(t).toHaveLength(10);
    expect(t[0]).toBe(0);
    expect(t[9]).toBe(99);
    expect(thin([1, 2, 3], 10)).toEqual([1, 2, 3]);
  });
});
