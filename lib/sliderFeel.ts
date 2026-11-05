/** Small pure helpers behind the slider feel (components/mobile/AmountSlider.tsx). */

/** How far, in px, a finger is past the ends of a track that runs from `left` to `right`:
 *  negative past the left end, positive past the right end, 0 on the track. */
export function edgeOvershoot(x: number, left: number, right: number): number {
  if (x < left) return x - left;
  if (x > right) return x - right;
  return 0;
}

/** Where the notches sit along the track, as a share 0..1, one per `step` from `min` to `max`. */
export function tickStops(min: number, max: number, step: number): number[] {
  if (!(max > min) || !(step > 0)) return [];
  const out: number[] = [];
  for (let v = min; v <= max + 1e-9; v += step) out.push((v - min) / (max - min));
  return out;
}
