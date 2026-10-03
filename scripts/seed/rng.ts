/** A seeded PRNG, so two runs with the same --as-of produce the same demo.
 *
 *  `Math.random()` cannot be used: the spec requires a run to be reproducible from its
 *  date, because a bug found today must still be findable tomorrow. mulberry32 is 32-bit
 *  state, which is ample here and is four lines.
 */

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** True with probability `p`. */
  chance(p: number): boolean;
  /** One element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** `count` independent coins at probability `p`. */
  flags(count: number, p: number): boolean[];
}

export function makeRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: <T,>(items: readonly T[]) => items[Math.floor(next() * items.length)],
    flags: (count, p) => Array.from({ length: count }, () => next() < p),
  };
}

/** A seed derived from the anchor date, so `--as-of=X` always yields the same demo.
 *  FNV-1a: cheap, and the scale name is mixed in so a smoke build never mirrors heavy. */
export function seedFromDate(isoDate: string): number {
  let h = 2166136261;
  for (let i = 0; i < isoDate.length; i++) {
    h ^= isoDate.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
