/** The silhouette of a card with a rounded rectangle SUBTRACTED from one corner -- the
 *  notch, RouteFlow's core visual identity (spec: 2026-09-08 notched-skeuomorphic-
 *  substrate design). Generalizes the previous lib/design/carve.ts, which hardcoded the
 *  notch to /sales's RTL top-inline-start corner. This version takes side/edge/dir
 *  explicitly so any surface, in either writing direction, can carve the same shape
 *  without duplicating the path math.
 *
 *  Written as a path rather than a mask image because the notch keeps a fixed size while
 *  the card is fluid: a mask sized in percentages stretches the corner radii as the card
 *  grows. Consumers pass their own measured box and set the result as
 *  `clip-path: path("...")`.
 */
export type NotchSide = "start" | "end";
export type NotchEdge = "top" | "bottom";

export type NotchOpts = {
  side?: NotchSide;
  edge?: NotchEdge;
  dir?: "rtl" | "ltr";
  notchWidth?: number;
  notchHeight?: number;
  radius?: number;
  innerRadius?: number;
  minWidth?: number;
};

/** "start"/"end" resolve to a physical corner using `dir`, exactly the way CSS logical
 *  properties do -- inline-start is the LEFT edge under ltr and the RIGHT edge under rtl. */
function resolvePhysicalSide(side: NotchSide, dir: "rtl" | "ltr"): "left" | "right" {
  if (dir === "ltr") return side === "start" ? "left" : "right";
  return side === "start" ? "right" : "left";
}

export function notchedCardPath(w: number, h: number, opts: NotchOpts = {}): string | null {
  const {
    side = "start",
    edge = "top",
    dir = "rtl",
    notchHeight: nh = 62,
    radius: R = 28,
    innerRadius: r = 20,
    minWidth = 360,
  } = opts;

  if (!(w > 0) || !(h > 0) || w < minWidth) return null;

  const nw = Math.max(190, Math.min(opts.notchWidth ?? 272, w - 120));
  const physicalSide = resolvePhysicalSide(side, dir);
  const flipX = physicalSide === "right";
  const flipY = edge === "bottom";

  // Build the path in a canonical "top-left notch" space, then mirror the x/y
  // coordinates afterward for the other three side/edge combinations -- this keeps the
  // path-construction logic itself written exactly once.
  const px = (x: number) => (flipX ? w - x : x);
  const py = (y: number) => (flipY ? h - y : y);
  const p = (x: number, y: number) => `${px(x).toFixed(2)},${py(y).toFixed(2)}`;

  // Sweep flags invert under either mirror axis (an odd number of flips reverses path
  // winding), so xor the two flags to pick the correct arc direction.
  const sweepOut = flipX !== flipY ? 0 : 1;
  const sweepIn = flipX !== flipY ? 1 : 0;

  return [
    `M ${p(R, 0)}`,
    `L ${p(w - nw - r, 0)}`,
    `A ${r} ${r} 0 0 ${sweepOut} ${p(w - nw, r)}`,
    `L ${p(w - nw, nh - r)}`,
    `A ${r} ${r} 0 0 ${sweepIn} ${p(w - nw + r, nh)}`,
    `L ${p(w - R, nh)}`,
    `A ${R} ${R} 0 0 ${sweepOut} ${p(w, nh + R)}`,
    `L ${p(w, h - R)}`,
    `A ${R} ${R} 0 0 ${sweepOut} ${p(w - R, h)}`,
    `L ${p(R, h)}`,
    `A ${R} ${R} 0 0 ${sweepOut} ${p(0, h - R)}`,
    `L ${p(0, R)}`,
    `A ${R} ${R} 0 0 ${sweepOut} ${p(R, 0)}`,
    "Z",
  ].join(" ");
}
