/** Deciding when one district row is really two places.
 *
 *  scripts/seed-districts.ts merges source features that share (name, level, parent) into
 *  a single MultiPolygon, because the Tehran KML draws some neighbourhoods as two
 *  overlapping placemarks and `UNIQUE(name, level, parent_name)` will not hold both. That
 *  is right for overlapping halves of one area and wrong for two different places that
 *  merely share a name -- and Tehran has several. کوهسار in منطقه ۴ is drawn twice, 21km
 *  apart, one in the west and one out by Tehranpars.
 *
 *  Merged, they behave as one row: selecting either selects both, a coverage status set
 *  on one silently applies to the other, and -- since territory now drives who sees what
 *  -- handing the district to a group hands them an enclave across the city, dragging
 *  its customers with it.
 */

export interface Ring {
  0: number;
  1: number;
  length: number;
  [index: number]: number;
}

export type LngLat = [number, number];

export interface PolyGeometry {
  type: "Polygon" | "MultiPolygon";
  coordinates: unknown;
}

/** Degrees to kilometres, near enough at Tehran's latitude for a "same place or not"
 *  question. No projection: the answers here differ by tens of kilometres, not metres. */
const KM_PER_DEGREE = 111;

/** Parts are separate places when they sit further apart than either is wide, by a clear
 *  margin, AND that distance is more than a neighbourhood could span.
 *
 *  Both conditions matter. The ratio alone would split a small area drawn as two lobes a
 *  few hundred metres apart; the absolute distance alone would split a genuinely large
 *  rural بخش whose parts are far apart simply because the whole thing is enormous. */
export const MIN_GAP_KM = 5;
export const MIN_GAP_RATIO = 2;

export function outerRings(geometry: PolyGeometry): LngLat[][] {
  if (geometry.type === "Polygon") {
    const rings = geometry.coordinates as LngLat[][];
    return rings?.[0] ? [rings[0]] : [];
  }
  const polys = (geometry.coordinates as LngLat[][][]) ?? [];
  return polys.map((p) => p[0]).filter((r) => Array.isArray(r) && r.length > 2);
}

export function centroidOf(ring: LngLat[]): LngLat {
  let x = 0;
  let y = 0;
  for (const [lng, lat] of ring) {
    x += lng;
    y += lat;
  }
  return [x / ring.length, y / ring.length];
}

/** Diagonal of the ring's bounding box, in km -- how big this part is. */
export function spanKm(ring: LngLat[]): number {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < minX) minX = lng;
    if (lng > maxX) maxX = lng;
    if (lat < minY) minY = lat;
    if (lat > maxY) maxY = lat;
  }
  return Math.hypot(maxX - minX, maxY - minY) * KM_PER_DEGREE;
}

export function distanceKm(a: LngLat, b: LngLat): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) * KM_PER_DEGREE;
}

/** The Persian compass word for where `part` lies relative to `anchor`. Whichever axis
 *  separates them more wins -- a label naming the lesser one would be misleading. */
export function directionWord(anchor: LngLat, part: LngLat): string {
  const dLng = part[0] - anchor[0];
  const dLat = part[1] - anchor[1];
  if (Math.abs(dLng) >= Math.abs(dLat)) return dLng >= 0 ? "شرق" : "غرب";
  return dLat >= 0 ? "شمال" : "جنوب";
}

export interface SplitPiece {
  name: string;
  geometry: { type: "Polygon"; coordinates: LngLat[][] };
  /** True for the piece that keeps the original row and its history. */
  keepsOriginal: boolean;
}

/** How this district should be broken up, or null if it should be left alone.
 *
 *  The largest piece keeps the original name and row: whatever history, photos and
 *  reminders already point at this district most likely belong to its main body, and a
 *  rename would strand every link anyone has shared. */
export function planSplit(name: string, geometry: PolyGeometry): SplitPiece[] | null {
  const rings = outerRings(geometry);
  if (rings.length < 2) return null;

  const centroids = rings.map(centroidOf);
  const spans = rings.map(spanKm);
  const widest = Math.max(...spans, 0.01);

  let gap = 0;
  for (let i = 0; i < centroids.length; i++) {
    for (let j = i + 1; j < centroids.length; j++) {
      gap = Math.max(gap, distanceKm(centroids[i], centroids[j]));
    }
  }
  if (gap < MIN_GAP_KM || gap / widest < MIN_GAP_RATIO) return null;

  const mainIndex = spans.indexOf(widest);
  const anchor = centroids[mainIndex];
  const used = new Set<string>([name]);

  return rings.map((ring, i) => {
    if (i === mainIndex) {
      return { name, geometry: { type: "Polygon" as const, coordinates: [ring] }, keepsOriginal: true };
    }
    let candidate = `${name} (${directionWord(anchor, centroids[i])})`;
    // Three pieces could land on the same side of the main body; a number keeps the
    // UNIQUE(name, level, parent) constraint satisfiable without inventing geography.
    let n = 2;
    while (used.has(candidate)) candidate = `${name} (${directionWord(anchor, centroids[i])} ${n++})`;
    used.add(candidate);
    return { name: candidate, geometry: { type: "Polygon" as const, coordinates: [ring] }, keepsOriginal: false };
  });
}
