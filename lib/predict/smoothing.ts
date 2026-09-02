/** Exponential smoothing — a pure module, no `db` import.
 *
 *  Holt's linear method (level + trend), two parameters, stable from ~3 points. It runs
 *  on the *deseasonalised* series: `lib/predict/seasonality` strips the shipped season
 *  shape out before this and puts it back after, so the recursion never has to learn a
 *  twelve-period cycle from a company that has three months of history.
 *
 *  `seasonalNaive` is the cold-start fallback used until there are ~8 observations.
 */

export interface HoltState {
  level: number;
  trend: number;
  alpha: number;
  beta: number;
}

/** Level = the first observation, trend = the mean first-difference (0 with < 2 points). */
export function holtInit(history: number[], alpha = 0.4, beta = 0.15): HoltState {
  if (history.length === 0) return { level: 0, trend: 0, alpha, beta };
  let trend = 0;
  if (history.length >= 2) {
    let sum = 0;
    for (let i = 1; i < history.length; i++) sum += history[i] - history[i - 1];
    trend = sum / (history.length - 1);
  }
  return { level: history[0], trend, alpha, beta };
}

/** One observation folded in → a new state. */
export function holtStep(s: HoltState, y: number): HoltState {
  const level = s.alpha * y + (1 - s.alpha) * (s.level + s.trend);
  const trend = s.beta * (level - s.level) + (1 - s.beta) * s.trend;
  return { level, trend, alpha: s.alpha, beta: s.beta };
}

/** `h` steps ahead, floored at 0 — demand cannot be negative. */
export function holtForecast(s: HoltState, h: number): number {
  return Math.max(0, s.level + h * s.trend);
}

export function ewmaStep(prev: number, y: number, alpha: number): number {
  return alpha * y + (1 - alpha) * prev;
}

/** The value from one season back, at horizon `h`. Falls back to the last value when
 *  the history is shorter than a season. */
export function seasonalNaive(history: number[], season: number, h: number): number {
  if (history.length === 0) return 0;
  if (history.length < season) return history[history.length - 1];
  const idx = history.length - season + ((h - 1) % season);
  return history[idx] ?? history[history.length - 1];
}

export function mae(errors: number[]): number {
  if (errors.length === 0) return 0;
  return errors.reduce((s, e) => s + Math.abs(e), 0) / errors.length;
}

export function mape(actual: number[], predicted: number[]): number {
  const terms: number[] = [];
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] === 0) continue;
    terms.push(Math.abs(actual[i] - (predicted[i] ?? 0)) / Math.abs(actual[i]));
  }
  if (terms.length === 0) return 0;
  return (terms.reduce((s, t) => s + t, 0) / terms.length) * 100;
}

/** A rough band around a point forecast: ±z · 1.25 · MAE (1.25·MAE ≈ σ for normal
 *  errors), floored at 0. z = 1.28 ≈ an 80% interval. */
export function predictionInterval(
  yhat: number,
  maeVal: number,
  z = 1.28
): { lo: number; hi: number } {
  const spread = z * 1.25 * Math.max(0, maeVal);
  return { lo: Math.max(0, yhat - spread), hi: yhat + spread };
}
