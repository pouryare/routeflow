/** The silhouette of a card with a rounded rectangle SUBTRACTED from its top
 *  inline-start corner -- see MASTER.md, "Carved bay card".
 *
 *  Written as a path rather than a mask image because the notch keeps a fixed size
 *  while the card is fluid: a mask sized in percentages stretches the corner radii as
 *  the card grows. Consumers pass their own measured box and set the result as
 *  `clip-path: path("...")`.
 *
 *  Coordinates are physical, and the bay is on the RIGHT because /sales is RTL and
 *  inline-start resolves there.
 */
export type CarveOpts = {
  notchWidth?: number;
  notchHeight?: number;
  radius?: number;
  innerRadius?: number;
  minWidth?: number;
};

export function carvedCardPath(w: number, h: number, opts: CarveOpts = {}): string | null {
  const {
    notchHeight: nh = 62,
    radius: R = 26,
    innerRadius: r = 20,
    minWidth = 360,
  } = opts;

  if (!(w > 0) || !(h > 0) || w < minWidth) return null;

  /* Always leave a shoulder. A notch wide enough to reach the far corner is not a bay,
     it is a shorter card, and the stepped edge stops reading. */
  const nw = Math.max(190, Math.min(opts.notchWidth ?? 272, w - 120));

  return [
    "M", R, 0,
    "H", w - nw - r,
    "A", r, r, 0, 0, 1, w - nw, r,          // convex: turn down into the bay
    "V", nh - r,
    "A", r, r, 0, 0, 0, w - nw + r, nh,     // concave: the step's inner corner
    "H", w - R,
    "A", R, R, 0, 0, 1, w, nh + R,          // the shoulder's top corner
    "V", h - R,
    "A", R, R, 0, 0, 1, w - R, h,
    "H", R,
    "A", R, R, 0, 0, 1, 0, h - R,
    "V", R,
    "A", R, R, 0, 0, 1, R, 0,
    "Z",
  ].join(" ");
}
