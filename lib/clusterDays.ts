import { LatLng, distanceKm, twoOptOrder } from "./geo";

/** Splitting a long list of stops into days.
 *
 *  The previous approach was to run one greedy nearest-neighbour pass over everything
 *  and then cut that single chain into fixed-size pieces. That is wrong in a specific
 *  and costly way: a nearest-neighbour chain is only locally sensible, so wherever the
 *  cut happens to land, the last stop of one day and the first of the next are
 *  frequently neighbours -- and worse, the greedy walk regularly strands one distant
 *  stop that then gets dragged into whichever day the cut assigns it to. The result is
 *  days that look ordered but are not grouped, which is exactly the failure mode of
 *  driving to four restaurants and missing the fifth two streets away.
 *
 *  This clusters first and orders second, which is the right way round: decide *which*
 *  stops belong to a day by where they are, then decide the order within that day.
 *
 *  ## Why balanced k-means, and why deterministic
 *
 *  Plain k-means produces geographically tight clusters of wildly different sizes -- a
 *  day with fifteen stops and a day with two. For a working day the size matters as much
 *  as the tightness, so assignment is capacity-capped: a stop whose nearest cluster is
 *  full spills to its next-nearest.
 *
 *  Seeding is farthest-point rather than random. k-means++ would give marginally better
 *  clusters on average, but at the cost of the same list splitting differently between
 *  two looks at it, which destroys any reason to trust the answer. Same input, same
 *  days, every time.
 */

/** Enough for the assignment to settle on the tens-of-stops lists this deals with.
 *  Convergence is detected and breaks out well before this; it is a guard, not a knob. */
const MAX_ITERATIONS = 30;

interface Centroid {
  lat: number;
  lng: number;
}

function centroidOf(points: LatLng[]): Centroid {
  // Plain arithmetic mean. Correct enough over a city: the meridian-convergence error
  // this ignores is metres, against clusters measured in kilometres.
  let lat = 0;
  let lng = 0;
  for (const p of points) {
    lat += p.lat;
    lng += p.lng;
  }
  return { lat: lat / points.length, lng: lng / points.length };
}

/** Deterministic maximin seeding: start from the stop farthest from the origin, then
 *  repeatedly take the stop that is farthest from everything chosen so far. Spreads the
 *  initial centroids across the whole extent instead of clumping them. */
function seedCentroids<T extends LatLng>(stops: T[], k: number, origin: LatLng | null): Centroid[] {
  const anchor = origin ?? stops[0];
  let first = stops[0];
  let bestDist = -1;
  for (const s of stops) {
    const d = distanceKm(anchor, s);
    if (d > bestDist) {
      bestDist = d;
      first = s;
    }
  }

  const seeds: Centroid[] = [{ lat: first.lat, lng: first.lng }];
  while (seeds.length < k) {
    let pick: T | null = null;
    let pickScore = -1;
    for (const s of stops) {
      let nearest = Infinity;
      for (const c of seeds) nearest = Math.min(nearest, distanceKm(s, c));
      if (nearest > pickScore) {
        pickScore = nearest;
        pick = s;
      }
    }
    if (!pick) break;
    seeds.push({ lat: pick.lat, lng: pick.lng });
  }
  return seeds;
}

/** Use provided source locations as centroids, supplementing with farthest-point
 *  seeding if there are fewer sources than needed. Deduplicates sources that are
 *  very close to each other (within 0.001° ≈ 100m). */
function seedFromSources<T extends LatLng>(
  stops: T[],
  sources: T[],
  k: number,
  origin: LatLng | null,
  distanceFn?: (a: LatLng, b: LatLng) => number
): Centroid[] {
  const dist = distanceFn ?? distanceKm;
  const centroids: Centroid[] = [];
  for (const src of sources) {
    const isDuplicate = centroids.some(
      (c) => dist(src, { lat: c.lat, lng: c.lng }) < 0.001
    );
    if (!isDuplicate) {
      centroids.push({ lat: src.lat, lng: src.lng });
    }
    if (centroids.length >= k) break;
  }
  // Supplement with farthest-point seeding from remaining stops
  if (centroids.length < k) {
    const taken = new Set(centroids.map((c) => `${c.lat},${c.lng}`));
    const remaining = stops.filter((s) => !taken.has(`${s.lat},${s.lng}`));
    let need = k - centroids.length;
    while (need > 0 && remaining.length > 0) {
      let bestIdx = 0;
      let bestScore = -Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const nearestToCentroids = centroids.reduce(
          (min, c) => Math.min(min, dist(remaining[i], { lat: c.lat, lng: c.lng })),
          Infinity
        );
        if (nearestToCentroids > bestScore) {
          bestScore = nearestToCentroids;
          bestIdx = i;
        }
      }
      centroids.push({ lat: remaining[bestIdx].lat, lng: remaining[bestIdx].lng });
      remaining.splice(bestIdx, 1);
      need--;
    }
  }
  return centroids;
}

/** One capacity-capped assignment pass.
 *
 *  Stops are placed in order of how strongly they prefer their nearest cluster -- the
 *  gap between the nearest and the second-nearest. A stop sitting squarely inside one
 *  cluster gets its choice; a stop midway between two is placed last, when it is the one
 *  best able to absorb going to the other. Without this ordering, an early
 *  indifferent stop can take the last seat in a cluster that a later stop genuinely
 *  belongs to.
 */
function assign<T extends LatLng>(stops: T[], centroids: Centroid[], capacity: number): T[][] {
  const ranked = stops
    .map((s) => {
      const dists = centroids.map((c) => distanceKm(s, c));
      const sorted = [...dists].sort((a, b) => a - b);
      const regret = sorted.length > 1 ? sorted[1] - sorted[0] : Infinity;
      return { stop: s, dists, regret };
    })
    .sort((a, b) => b.regret - a.regret);

  const clusters: T[][] = centroids.map(() => []);
  for (const { stop, dists } of ranked) {
    const order = dists
      .map((d, i) => ({ d, i }))
      .sort((a, b) => a.d - b.d);
    const target = order.find(({ i }) => clusters[i].length < capacity) ?? order[0];
    clusters[target.i].push(stop);
  }
  return clusters;
}

export interface DayCluster<T> {
  /** Stops in the order they should be driven, from the origin. */
  stops: T[];
  /** Straight-line centre of the day, for labelling and for sorting the days. */
  centre: Centroid;
}

/** Splits `stops` into `dayCount` geographically coherent days, each ordered for driving.
 *
 *  Days come back nearest-first from the origin, so "day 1" is the one closest to home.
 *  Empty clusters are dropped rather than returned as empty days -- asking for five days
 *  from four stops gives four days, not five with a gap.
 *
 *  If `seeds` is provided, those locations are used as initial cluster centroids (instead
 *  of farthest-point seeding), ensuring priority locations drive the clustering. */
export function clusterIntoDays<T extends LatLng>(
  stops: T[],
  dayCount: number,
  origin: LatLng | null,
  distanceFn?: (a: LatLng, b: LatLng) => number,
  seeds?: T[],
  maxPerDay?: number
): DayCluster<T>[] {
  if (stops.length === 0) return [];

  const k = Math.max(1, Math.min(Math.floor(dayCount), stops.length));
  if (k === 1) {
    const ordered = origin ? twoOptOrder(stops, origin, false, distanceFn) : stops.slice();
    return [{ stops: ordered, centre: centroidOf(stops) }];
  }

  const capacity = maxPerDay ?? Math.ceil(stops.length / k);
  const centroidSources = seeds && seeds.length > 0 ? seeds : undefined;
  let centroids = centroidSources
    ? seedFromSources(stops, centroidSources, k, origin, distanceFn)
    : seedCentroids(stops, k, origin);
  let clusters = assign(stops, centroids, capacity);

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const next = clusters.map((c, idx) => (c.length ? centroidOf(c) : centroids[idx]));
    const moved = next.some((c, idx) => distanceKm(c, centroids[idx]) > 1e-6);
    centroids = next;
    if (!moved) break;
    clusters = assign(stops, centroids, capacity);
  }

  const days = clusters
    .map((c, idx) => ({ stops: c, centre: c.length ? centroidOf(c) : centroids[idx] }))
    .filter((d) => d.stops.length > 0);

  if (seeds && seeds.length > 0) {
    const seedLatSet = new Set(seeds.map((s) => s.lat));
    const seedLngSet = new Set(seeds.map((s) => s.lng));
    const seedLatArr = [...seedLatSet];
    const seedLngArr = [...seedLngSet];
    days.sort((a, b) => {
      const aSeed = a.stops.some((s) => seedLatArr.includes(s.lat) && seedLngArr.includes(s.lng)) ? 0 : 1;
      const bSeed = b.stops.some((s) => seedLatArr.includes(s.lat) && seedLngArr.includes(s.lng)) ? 0 : 1;
      return aSeed - bSeed;
    });
  }

  if (origin) days.sort((a, b) => distanceKm(origin, a.centre) - distanceKm(origin, b.centre));

  return days.map((d) => ({
    ...d,
    stops: origin ? twoOptOrder(d.stops, origin, false, distanceFn) : d.stops,
  }));
}

/** How many days a list of this length needs at a given stops-per-day target. */
export function daysNeeded(stopCount: number, stopsPerDay: number): number {
  if (stopCount === 0 || stopsPerDay <= 0) return 0;
  return Math.ceil(stopCount / stopsPerDay);
}
