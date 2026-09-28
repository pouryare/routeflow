/** Squircle corners: one shape for every user, on every browser.
 *
 *  CSS `corner-shape: superellipse()` shipped in Chrome 139 but is still unlanded in
 *  Firefox and only in Safari's Technology Preview, so roughly 29% of users never see it.
 *  The fallback is a clip-path, which costs box-shadow and clips descendants -- so the list
 *  below is deliberately the *only* place a surface becomes a squircle, and it is consumed
 *  by both the CSS rule and the JS fallback so the two cannot drift.
 *
 *  Every selector is prefixed `.meridian` because that is a single wrapper class in
 *  app/(shell)/layout.tsx:26. The prefix costs nothing and keeps a stray `card` in another
 *  skin out of the clip.
 *
 *  `pagehead` has no usage today. It stays because PageHeaderCard is clearly waiting for
 *  it; dropping it would make adding that surface a second, disconnected edit.
 */

/** Every surface that gets a squircle. One list, two consumers. */
export const SQUIRCLE_SELECTORS = [
  ".meridian .kblock",
  ".meridian .card",
  ".meridian .gcard",
  ".meridian .face",
  ".meridian .pocketed__face",
  ".meridian .modal",
  ".meridian .sheet",
  ".meridian .island",
  ".meridian .mwork",
  ".meridian .mapside",
  ".meridian .prow",
  ".meridian .ptile",
  ".meridian .pagehead",
  ".meridian .seg-item > a",
] as const;

/** The exponent every surface squircle is drawn at.
 *
 *  Measured by rendering corners in Chromium 151 and integrating the corner's area: this
 *  exponent yields a corner 1.110x the area of a true circle, which reads as a deliberate
 *  squircle rather than a lozenge. Named here because the CSS and the JS fallback must
 *  agree, and a magic number duplicated in two files is a magic number that drifts. */
export const SUPERELLIPSE_N = 1.5;

/** The value the native path uses. Kept beside the exponent so the @supports probe in CSS
 *  and the probe in JS are testing for the same feature, not merely a similar one. */
export const CORNER_SHAPE_VALUE = `superellipse(${SUPERELLIPSE_N})`;

/** True where the browser draws the corner itself and we do no work at all.
 *
 *  Guarded on `typeof CSS` because the unit suite runs in node, where CSS is undefined --
 *  asking a bare `CSS.supports` there is a ReferenceError, not a false. */
export function supportsCornerShape(): boolean {
  return (
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("corner-shape", CORNER_SHAPE_VALUE)
  );
}

/** A corner radius as CSS hands it back: a length, a percentage, or unreadable. */
export type CornerRadius = number | string | null;

/** The 999px convention, named so the number is not retyped as a literal. */
export const PILL_RADIUS_PX = 999;

/** True when the radius makes the shape a pill -- 999px, `50%`, or half the shorter side.
 *
 *  A pill is the one shape where a squircle is not a refinement but an impossibility: at a
 *  full semicircle the superellipse and the circular arc are the same curve, so clipping one
 *  buys nothing and costs the box-shadow. Pills keep plain radii.
 *
 *  Zero is explicitly NOT a pill. A zero radius is a square corner that still needs the full
 *  path, and dropping it would leave it on an arc beside clipped neighbours. */
export function isPillRadius(
  radius: CornerRadius,
  width: number,
  height: number,
): boolean {
  if (radius === null || radius === "none" || radius === "") return false;

  if (typeof radius === "string" && radius.trim().endsWith("%")) {
    const pct = Number.parseFloat(radius);
    if (!Number.isFinite(pct)) return false;
    return pct >= 50;
  }

  const px = typeof radius === "number" ? radius : Number.parseFloat(radius);
  if (!Number.isFinite(px) || px <= 0) return false;

  if (px >= PILL_RADIUS_PX) return true;
  return px >= Math.min(width, height) / 2;
}

/** Pull a single usable pixel radius out of whatever getComputedStyle returned.
 *
 *  Returns null rather than 0 when the value cannot be read, so the caller can leave the
 *  element alone; a 0 would silently produce a square-cornered clip. */
export function parseCornerRadius(raw: string): number | null {
  if (!raw) return null;
  const first = raw.trim().split(/\s+/)[0];
  const px = Number.parseFloat(first);
  return Number.isFinite(px) ? px : null;
}

const K = 0.765437;
const r2 = (n: number) => Math.round(n * 100) / 100;

type Pt = [number, number];

/** One corner, as a cubic bezier from its incoming edge to its outgoing edge.
 *
 *  `ix,iy` is the unit vector along the incoming edge (pointing at the vertex) and
 *  `ox,oy` the unit vector along the outgoing edge (pointing away from it). A circular arc
 *  would put the first control point 0.5523r along the outgoing direction; pushing that
 *  out to K*r is what makes the corner a squircle -- the curve leaves the edge flatter and
 *  arrives at the next edge already turning, so curvature carries across the join instead
 *  of stopping and restarting.
 *
 *  K is not a guess. It was fitted so this corner's AREA equals Chromium's measured
 *  superellipse(1.5) -- 1.1094x a quarter circle -- which is what makes the JS fallback
 *  and the native CSS agree on area rather than merely on looking similar. The area ratio
 *  is scale-invariant, so one constant serves every radius in the scale. Verified: the
 *  same construction at K=0.5522847498 measures 1.0002x, i.e. a true circle. */
function corner(
  cx: number, cy: number, ix: number, iy: number, ox: number, oy: number, r: number,
) {
  const c = K * r;
  return {
    s: [cx - ix * r, cy - iy * r] as Pt,
    c1: [cx - ix * r + ox * c, cy - iy * r + oy * c] as Pt,
    c2: [cx + ox * r - ix * c, cy + oy * r - iy * c] as Pt,
    e: [cx + ox * r, cy + oy * r] as Pt,
  };
}

/** A closed squircle path for a w x h box with the given corner radius.
 *
 *  Traversed clockwise. Each corner's end point sits on the same edge the next corner
 *  starts from, so the L between them is the straight run along that edge.
 *
 *  Returns "" for a box or radius with no area, so a caller applying this to a collapsed
 *  element clears any previous clip instead of writing a broken path. */
export function superellipsePath(w: number, h: number, r: number): string {
  if (w <= 0 || h <= 0 || r <= 0) return "";
  const tl = corner(0, 0, 0, -1, 1, 0, r);
  const tr = corner(w, 0, 1, 0, 0, 1, r);
  const br = corner(w, h, 0, 1, -1, 0, r);
  const bl = corner(0, h, -1, 0, 0, -1, r);
  const C = (o: ReturnType<typeof corner>) =>
    `C ${r2(o.c1[0])} ${r2(o.c1[1])} ${r2(o.c2[0])} ${r2(o.c2[1])} ${r2(o.e[0])} ${r2(o.e[1])}`;
  const L = (p: Pt) => `L ${r2(p[0])} ${r2(p[1])}`;
  return [
    `M ${r2(tr.s[0])} ${r2(tr.s[1])}`,
    C(tr),
    L(br.s),
    C(br),
    L(bl.s),
    C(bl),
    L(tl.s),
    C(tl),
    "Z",
  ].join(" ");
}

/** The area of one corner of this construction, as a fraction of a quarter circle of the
 *  same radius. This is the objective K was fitted to; it lives beside the path it must
 *  describe so the two cannot drift. Exported for the tests, which assert both that a true
 *  circle scores 1.0 here and that K scores the 1.1094 the native path produces. */
export function cornerAreaRatio(k: number, r: number, samples = 20_000): number {
  const P: Pt[] = [
    [0, r],
    [k * r, r],
    [r, k * r],
    [r, 0],
  ];
  let x = 0;
  let y = 0;
  let area = 0;
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const mt = 1 - t;
    const b0 = mt * mt * mt;
    const b1 = 3 * mt * mt * t;
    const b2 = 3 * mt * t * t;
    const b3 = t * t * t;
    const nx = b0 * P[0][0] + b1 * P[1][0] + b2 * P[2][0] + b3 * P[3][0];
    const ny = b0 * P[0][1] + b1 * P[1][1] + b2 * P[2][1] + b3 * P[3][1];
    area += 0.5 * (x * ny - nx * y);
    x = nx;
    y = ny;
  }
  return Math.abs(area) / (Math.PI * r * r * 0.25);
}
