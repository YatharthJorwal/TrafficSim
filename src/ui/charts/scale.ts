/** Pure helpers for the SVG charts: tick choice, scales and hit-testing. No DOM, no React. */

/** Round tick values covering [min, max], about `target` of them, at 1, 2 or 5 times a power of ten. */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  if (max < min) [min, max] = [max, min];
  if (max === min) {
    if (min === 0) return [0, 1];
    max = min + Math.abs(min) * 0.1;
  }
  const rough = (max - min) / Math.max(1, target);
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const frac = rough / pow;
  const step = (frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10) * pow;
  const first = Math.ceil(min / step - 1e-9) * step;
  const out: number[] = [];
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  for (let i = 0; first + i * step <= max + step * 1e-9; i++) {
    const v = Number((first + i * step).toFixed(decimals));
    out.push(v === 0 ? 0 : v); // no -0, no 0.30000000000000004
  }
  return out;
}

/** Smallest "nice" number that is at least `v` (so a bar axis ends on a round value). */
export function niceCeil(v: number): number {
  if (!(v > 0)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const frac = v / pow;
  return (frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 2.5 ? 2.5 : frac <= 5 ? 5 : 10) * pow;
}

export function linear(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const span = d1 - d0 || 1;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}

/** Index of the value in the sorted array `xs` closest to `x`. Returns -1 for an empty array. */
export function nearestIndex(xs: readonly number[], x: number): number {
  if (xs.length === 0) return -1;
  let lo = 0;
  let hi = xs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(xs[lo - 1] - x) <= Math.abs(xs[lo] - x)) return lo - 1;
  return lo;
}

/** Tick label with no more decimals than needed: 12, 2.5, 0.25. Large values are not abbreviated below 10,000. */
export function formatNumber(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return 'n/a';
  const a = Math.abs(v);
  if (a >= 10000) return `${(v / 1000).toFixed(a >= 100000 ? 0 : 1).replace(/\.0$/, '')}K`;
  return String(Number(v.toFixed(digits)));
}

export function formatSigned(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return 'n/a';
  const s = formatNumber(v, digits);
  return v > 0 ? `+${s}` : s;
}

/** m:ss for simulated seconds. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Keep at most `limit` items, evenly spread, always including the first and the last. */
export function thin<T>(items: readonly T[], limit: number): T[] {
  if (items.length <= limit || limit < 2) return [...items];
  const out: T[] = [];
  for (let i = 0; i < limit; i++) out.push(items[Math.round((i * (items.length - 1)) / (limit - 1))]);
  return out;
}
