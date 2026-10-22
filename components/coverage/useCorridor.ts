"use client";

import { useEffect, useMemo, useState } from "react";
import { corridorBandFromPath, distanceKm, distanceToPathKm } from "@/lib/geo";
import { fetchDrivingRoute, type DrivingRoute } from "@/lib/osrm";
import type { LatLng } from "@/lib/geo";
import type { FacilityRow } from "@/lib/facilityTypes";
import type { DistrictProperties } from "@/lib/types";

/** The corridor between the two furthest-apart depots: the road joining them (or the straight line when the
 *  router cannot be reached), the band around it, and which districts fall inside. Moved out of CoverageMap
 *  unchanged; it depends on nothing in the map but the four inputs. */
export function useCorridor({
  on: corridorOn,
  widthKm: corridorWidthKm,
  placedFacilities,
  districtProps,
}: {
  on: boolean;
  widthKm: number;
  placedFacilities: (FacilityRow & { lat: number; lng: number })[];
  districtProps: DistrictProperties[];
}) {
  const corridorEnds = useMemo(() => {
    if (placedFacilities.length < 2) return null;
    let best: { a: (typeof placedFacilities)[number]; b: (typeof placedFacilities)[number]; km: number } | null = null;
    for (let i = 0; i < placedFacilities.length; i++) {
      for (let j = i + 1; j < placedFacilities.length; j++) {
        const km = distanceKm(placedFacilities[i], placedFacilities[j]);
        if (!best || km > best.km) best = { a: placedFacilities[i], b: placedFacilities[j], km };
      }
    }
    return best;
  }, [placedFacilities]);

  /* ---- The corridor follows the road, not the crow.

     Drawn as a straight band between the two depots, the corridor claimed a stretch of
     city nobody drives through and disowned the districts along the road that actually
     joins them -- which is the whole question it exists to answer. So the route is
     fetched once and everything downstream is computed against the road geometry.

     The straight line survives as the fallback, and the sidebar says which one is on
     screen: a corridor quietly drawn down the wrong streets is worse than one that
     admits it could not reach the router. ---- */
  const corridorKey = corridorEnds ? `${corridorEnds.a.id}-${corridorEnds.b.id}` : null;

  /** What came back, and which pair of depots it came back for. Storing the two together
   *  means "still routing" is derived from them rather than kept as a second flag that
   *  could disagree -- and an answer for a pair of depots that are no longer the corridor
   *  reads as absent instead of as a stale road. */
  const [corridorAnswer, setCorridorAnswer] = useState<{ key: string; route: DrivingRoute | null } | null>(null);

  useEffect(() => {
    if (!corridorOn || !corridorEnds || !corridorKey) return;
    if (corridorAnswer?.key === corridorKey) return;

    const controller = new AbortController();
    let live = true;
    fetchDrivingRoute(corridorEnds.a, corridorEnds.b, controller.signal).then((route) => {
      if (live) setCorridorAnswer({ key: corridorKey, route });
    });
    return () => {
      live = false;
      controller.abort();
    };
    // Only the endpoints change the road. Widening the band re-measures against the same
    // route rather than asking for it again.
  }, [corridorOn, corridorEnds, corridorKey, corridorAnswer]);

  const corridorRoute = corridorAnswer?.key === corridorKey ? corridorAnswer.route : null;
  const corridorRouting = corridorOn && corridorKey !== null && corridorAnswer?.key !== corridorKey;

  const corridorPath = useMemo<LatLng[]>(() => {
    if (corridorRoute) return corridorRoute.path;
    if (corridorEnds) {
      return [
        { lat: corridorEnds.a.lat, lng: corridorEnds.a.lng },
        { lat: corridorEnds.b.lat, lng: corridorEnds.b.lng },
      ];
    }
    return [];
  }, [corridorRoute, corridorEnds]);

  const corridorBand = useMemo(
    () => corridorBandFromPath(corridorPath, corridorWidthKm),
    [corridorPath, corridorWidthKm]
  );

  /** District ids whose centre falls inside the band. Districts with no centroid are
   *  absent rather than assumed outside -- they simply cannot be judged.
   *
   *  Measured against the route itself rather than tested inside the drawn polygon: the
   *  distance is exact through every bend, while the polygon is an approximation that can
   *  cross itself at a hairpin. */
  const corridorDistrictIds = useMemo(() => {
    if (!corridorOn || corridorPath.length < 2) return null;
    const ids = new Set<number>();
    for (const d of districtProps) {
      if (d.centroid_lat === null || d.centroid_lng === null) continue;
      if (distanceToPathKm({ lat: d.centroid_lat, lng: d.centroid_lng }, corridorPath) <= corridorWidthKm) {
        ids.add(d.id);
      }
    }
    return ids;
  }, [corridorOn, corridorPath, corridorWidthKm, districtProps]);

  const corridorUncovered = useMemo(() => {
    if (!corridorDistrictIds) return 0;
    return districtProps.filter((d) => corridorDistrictIds.has(d.id) && d.coverage_status === "needs_coverage").length;
  }, [corridorDistrictIds, districtProps]);

  return {
    ends: corridorEnds,
    route: corridorRoute,
    routing: corridorRouting,
    path: corridorPath,
    band: corridorBand,
    districtIds: corridorDistrictIds,
    uncovered: corridorUncovered,
  };
}
