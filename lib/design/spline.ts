/** A Catmull-Rom spline through the points, converted to cubic béziers.
 *
 *  A real curve, not a polyline pretending to be one: the control points are derived
 *  from the neighbours of each segment, so the line passes exactly through every data
 *  point while staying smooth across them. Endpoints duplicate their neighbour, which
 *  is what stops the curve overshooting at the ends of the series.
 */
export type Pt = { x: number; y: number };

export function splinePath(points: Pt[]): string {
  if (points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

export function areaPath(points: Pt[], baseline: number): string {
  const line = splinePath(points);
  if (!line) return "";
  const last = points[points.length - 1];
  const first = points[0];
  return `${line} L ${last.x} ${baseline} L ${first.x} ${baseline} Z`;
}
