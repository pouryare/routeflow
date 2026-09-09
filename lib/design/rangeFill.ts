/** The filled-track percentage for a range input -- extracted as a pure function so it
 *  can be unit tested without rendering a component (this repo has no
 *  @testing-library/react / jsdom setup). Matches the fill fraction ProcessingModal's
 *  read-only meter already computes; RangeSlider is the first genuinely interactive
 *  (draggable) consumer. */
export function fillPercent(value: number, min: number, max: number): number {
  return max > min ? ((value - min) / (max - min)) * 100 : 0;
}
