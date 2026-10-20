/** `n` pulled into `[lo, hi]`. Callers keep `lo <= hi`; there is no defined answer otherwise. */
export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Round to two decimal places. */
export const round2 = (v: number): number => Math.round(v * 100) / 100;
