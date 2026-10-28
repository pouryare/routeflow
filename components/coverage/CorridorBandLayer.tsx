"use client";

import { useMemo } from "react";
import { Layer, Source } from "@vis.gl/react-maplibre";
import { useCorridor } from "@/components/coverage/useCorridor";
import { FACILITY_COLOR } from "@/lib/facilityTypes";

/** The corridor band and the dashed line down its middle, drawn inside the map. Only
 *  painted, never clicked, so it never swallows a tap meant for a district underneath. */
export default function CorridorBandLayer({ corridorOn, corridorEnds, corridorBand, corridorPath, lightGround, beforeId }: {
  corridorOn: boolean;
  corridorEnds: ReturnType<typeof useCorridor>["ends"];
  corridorBand: ReturnType<typeof useCorridor>["band"];
  corridorPath: ReturnType<typeof useCorridor>["path"];
  lightGround: boolean;
  beforeId?: string;
}) {
  const data = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: [
      // The band is [lat, lng] pairs; GeoJSON wants [lng, lat] and a closed ring.
      { type: "Feature", properties: { part: "band" }, geometry: { type: "Polygon", coordinates: [[...corridorBand, corridorBand[0]].filter(Boolean).map(([lat, lng]) => [lng, lat])] } },
      { type: "Feature", properties: { part: "path" }, geometry: { type: "LineString", coordinates: corridorPath.map((p) => [p.lng, p.lat]) } },
    ],
  }), [corridorBand, corridorPath]);

  if (!(corridorOn && corridorEnds && corridorBand.length > 0)) return null;
  /* A 7% fill and a half-opacity edge were tuned against a near-black ground; over a cream
     basemap the band all but disappears. Same colour, carried harder. */
  return (
    <Source id="corridor" type="geojson" data={data}>
      <Layer id="corridor-fill" type="fill" beforeId={beforeId} filter={["==", ["get", "part"], "band"]}
        paint={{ "fill-color": FACILITY_COLOR, "fill-opacity": lightGround ? 0.13 : 0.07 }} />
      <Layer id="corridor-edge" type="line" beforeId={beforeId} filter={["==", ["get", "part"], "band"]}
        paint={{ "line-color": FACILITY_COLOR, "line-width": 1, "line-opacity": lightGround ? 0.75 : 0.5 }} />
      <Layer id="corridor-path" type="line" beforeId={beforeId} filter={["==", ["get", "part"], "path"]}
        paint={{ "line-color": FACILITY_COLOR, "line-width": 2, "line-opacity": lightGround ? 0.9 : 0.75, "line-dasharray": [4, 3] }} />
    </Source>
  );
}
