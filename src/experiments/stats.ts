/** Small statistics helpers for repeated runs. Pure functions, no randomness. */

export interface Summary {
  n: number;
  mean: number;
  /** Sample standard deviation (n - 1). 0 when n < 2. */
  sd: number;
  min: number;
  max: number;
  /** Half-width of the 95 % confidence interval of the mean (Student t). null when n < 2. */
  ci95: number | null;
}

/** Two-sided 95 % Student t critical values for 1..30 degrees of freedom; 1.96 beyond. */
const T95 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101,
  2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];

export function tCritical95(degreesOfFreedom: number): number {
  if (degreesOfFreedom < 1) return NaN;
  return degreesOfFreedom <= T95.length ? T95[degreesOfFreedom - 1] : 1.96;
}

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function summarize(xs: readonly number[]): Summary {
  const n = xs.length;
  if (n === 0) return { n: 0, mean: NaN, sd: NaN, min: NaN, max: NaN, ci95: null };
  const m = mean(xs);
  let ss = 0;
  for (const x of xs) ss += (x - m) * (x - m);
  const sd = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;
  return {
    n,
    mean: m,
    sd,
    min: Math.min(...xs),
    max: Math.max(...xs),
    ci95: n > 1 ? (tCritical95(n - 1) * sd) / Math.sqrt(n) : null,
  };
}

/** Linear-interpolated percentile, p in [0, 1]. */
export function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const pos = Math.min(1, Math.max(0, p)) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export interface PairedComparison {
  /** Summary of (candidate - reference) over the paired seeds. */
  difference: Summary;
  /** Seeds where the candidate was better, equal (within `tolerance`) or worse. "Better" respects `lowerIsBetter`. */
  better: number;
  tied: number;
  worse: number;
}

/**
 * Pair two runs per seed (same schedule) and describe the difference candidate - reference.
 * `tolerance` is the absolute difference below which two results count as tied.
 */
export function comparePaired(
  reference: readonly number[],
  candidate: readonly number[],
  lowerIsBetter: boolean,
  tolerance = 0,
): PairedComparison {
  if (reference.length !== candidate.length) throw new Error('paired samples need the same number of seeds');
  const diffs = candidate.map((c, i) => c - reference[i]);
  let better = 0;
  let tied = 0;
  let worse = 0;
  for (const d of diffs) {
    if (Math.abs(d) <= tolerance) tied++;
    else if ((d < 0) === lowerIsBetter) better++;
    else worse++;
  }
  return { difference: summarize(diffs), better, tied, worse };
}
