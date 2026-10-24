import { mulberry32 } from '../../sim/rng';

/** Seeded helpers so scenery is identical on every load (no Math.random anywhere in the scene). */
export function makeRng(seed: number) {
  const next = mulberry32(seed);
  return {
    next,
    range: (a: number, b: number) => a + (b - a) * next(),
    int: (a: number, b: number) => a + Math.floor(next() * (b - a + 1)),
    chance: (p: number) => next() < p,
    pick: <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
  };
}
export type Rng = ReturnType<typeof makeRng>;
