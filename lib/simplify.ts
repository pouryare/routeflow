// Polygon decimation for the two district-geometry precision tiers served by
// /api/districts/geometry. Both tiers are derived from the same untouched
// `districts.boundary_geojson` column -- nothing here ever writes back to the DB, so
// full-precision source geometry stays intact and a tier can be re-tuned by bumping
// PRECISION_TIERS and rebuilding, with no migration.

export type GeoJsonPosition = [number, number];
export type Ring = GeoJsonPosition[];

/** Squared distance from p to segment a-b, in raw degrees. Degrees (not meters) are
 *  fine as a simplification metric here: every polygon is inside Tehran province, so
 *  the lat/lng scale distortion across the dataset is a few percent -- far below the
 *  precision the tolerance is chosen at. */
function sqSegDist(p: GeoJsonPosition, a: GeoJsonPosition, b: GeoJsonPosition): number {
  let x = a[0];
  let y = a[1];
  let dx = b[0] - x;
  let dy = b[1] - y;

  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b[0];
      y = b[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }

  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

/** Douglas-Peucker, iterative rather than recursive: a few of the mahalle rings run to
 *  hundreds of points and a pathological (near-collinear) one would recurse once per
 *  point, so an explicit stack keeps this safe regardless of input shape. */
function douglasPeucker(points: Ring, sqTolerance: number): Ring {
  const last = points.length - 1;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[last] = 1;

  const stack: number[] = [0, last];
  while (stack.length > 0) {
    const end = stack.pop() as number;
    const start = stack.pop() as number;
    let maxSq = sqTolerance;
    let index = -1;

    for (let i = start + 1; i < end; i++) {
      const d = sqSegDist(points[i], points[start], points[end]);
      if (d > maxSq) {
        index = i;
        maxSq = d;
      }
    }

    if (index > 0) {
      keep[index] = 1;
      stack.push(start, index, index, end);
    }
  }

  const out: Ring = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/** A GeoJSON linear ring needs >= 4 positions (first == last). Anything that would
 *  decimate below that is returned untouched rather than emitted as invalid geometry
 *  that Leaflet would silently drop. */
export function simplifyRing(ring: Ring, tolerance: number): Ring {
  if (tolerance <= 0 || ring.length <= 4) return ring;
  const simplified = douglasPeucker(ring, tolerance * tolerance);
  return simplified.length >= 4 ? simplified : ring;
}

export function roundPosition(p: GeoJsonPosition, decimals: number): GeoJsonPosition {
  const f = 10 ** decimals;
  return [Math.round(p[0] * f) / f, Math.round(p[1] * f) / f];
}

interface PolygonGeometry {
  type: "Polygon";
  coordinates: Ring[];
}
interface MultiPolygonGeometry {
  type: "MultiPolygon";
  coordinates: Ring[][];
}
export type DistrictGeometry = PolygonGeometry | MultiPolygonGeometry;

/** Simplify then round every ring of a Polygon/MultiPolygon. Order matters: rounding
 *  first would collapse distinct points into duplicates that Douglas-Peucker then has
 *  to weigh as real vertices. */
export function decimateGeometry(
  geometry: DistrictGeometry,
  tolerance: number,
  decimals: number
): DistrictGeometry {
  const ring = (r: Ring) => simplifyRing(r, tolerance).map((p) => roundPosition(p, decimals));
  if (geometry.type === "Polygon") {
    return { type: "Polygon", coordinates: geometry.coordinates.map(ring) };
  }
  return { type: "MultiPolygon", coordinates: geometry.coordinates.map((poly) => poly.map(ring)) };
}

/** Area-weighted centroid of a polygon or multipolygon, as {lat, lng}.
 *
 *  Districts are ranked and measured by "how far away is it", which needs one point per
 *  district. The area-weighted centre is the right one: a plain average of vertices
 *  drifts toward whichever edge the source data happened to draw with more points, and
 *  picking the first ring lets a small detached piece stand in for the whole district.
 *
 *  Computed in raw degrees rather than a projection. Over a Tehran district the
 *  distortion is far below the kilometre-scale distances this feeds, and every
 *  alternative drags in a projection library for no gain at this precision.
 *
 *  Returns null when there is nothing to measure, so callers store NULL rather than a
 *  NaN that would silently poison every distance computed from it. */
export function polygonCentroid(geometry: DistrictGeometry): { lat: number; lng: number } | null {
  const polygons: Ring[][] = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;

  let areaTotal = 0;
  let xTotal = 0;
  let yTotal = 0;
  const allPoints: GeoJsonPosition[] = [];

  for (const rings of polygons) {
    // Only the outer ring positions the shape. A hole moves the true centroid, but a
    // district's holes are enclaves whose effect is far below the resolution this feeds.
    const outer = rings[0];
    if (!outer || outer.length < 3) continue;
    allPoints.push(...outer);

    // Shoelace. The signed area is negative for one winding direction and positive for
    // the other; using the signed value in both the numerator and the weight makes the
    // sign cancel, so winding never matters.
    let signedArea = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < outer.length - 1; i++) {
      const [x0, y0] = outer[i];
      const [x1, y1] = outer[i + 1];
      const cross = x0 * y1 - x1 * y0;
      signedArea += cross;
      cx += (x0 + x1) * cross;
      cy += (y0 + y1) * cross;
    }
    signedArea /= 2;
    if (signedArea === 0) continue;

    xTotal += cx / 6;
    yTotal += cy / 6;
    areaTotal += signedArea;
  }

  if (areaTotal !== 0) {
    return { lng: xTotal / areaTotal, lat: yTotal / areaTotal };
  }

  // Every ring was degenerate (zero area) -- a line, or a repeated point. The bounding
  // box centre is still a usable location, and a district drawn that badly should show
  // up somewhere sensible rather than not at all.
  if (allPoints.length === 0) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of allPoints) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { lng: (minX + maxX) / 2, lat: (minY + maxY) / 2 };
}
