/** A vertical S-curve between a parent step and a child step -- spec 2026-09-08 §9c's
 *  "curved bezier edges between task nodes." Control points sit at the vertical
 *  midpoint between the two nodes, offset horizontally toward each endpoint, which is
 *  what gives the curve its S shape rather than a straight diagonal line. */
export function bezierPath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const midY = (from.y + to.y) / 2;
  return `M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`;
}
