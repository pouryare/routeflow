"use client";
import { useEffect, useMemo, useState } from "react";
import { fetchOsrmTable } from "@/lib/routing/osrmMatrix";
import type { LatLng } from "@/lib/geo";

/** The OSRM road-distance matrix for `points`, in the same order, or null until it arrives
 *  (or when OSRM cannot answer, in which case callers fall back to straight lines).
 *
 *  Keyed by the points themselves: a matrix fetched for one set of stops is NEVER handed back
 *  for another. `fromMatrix` indexes the table by position, so a stale table answers "how far
 *  is stop 3 from stop 7?" about the wrong stops -- with a plausible number, which is the
 *  dangerous shape. Changing points refetches; unmounting or changing them aborts the
 *  request in flight. */
export function useRouteMatrix(points: LatLng[]) {
  const key = useMemo(() => points.map((p) => `${p.lat},${p.lng}`).join("|"), [points]);
  const [result, setResult] = useState<{ key: string; km: number[][] } | null>(null);

  useEffect(() => {
    if (!key) return;
    const pts = key.split("|").map((pair) => {
      const [lat, lng] = pair.split(",").map(Number);
      return { lat, lng };
    });
    if (pts.length < 2 || pts.length > 100) return;
    const controller = new AbortController();
    fetchOsrmTable(pts, controller.signal).then((table) => {
      if (table && !controller.signal.aborted) setResult({ key, km: table.distances_km });
    });
    return () => controller.abort();
  }, [key]);

  return { matrix: result && result.key === key ? result.km : null };
}
