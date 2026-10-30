"use client";

import { useMemo } from "react";
import { Layer, Source } from "@vis.gl/react-maplibre";
import type { ExpressionSpecification } from "maplibre-gl";
import { CustomerRow } from "@/lib/types";

// Single-hue sequential ramp (dataviz skill: "sequential = one hue, light->dark,
// never a rainbow"). Low end recedes toward the dark bg, high end is the app's own
// --accent/--accent-dim tokens plus a near-white peak for the hottest spots --
// no unrelated hues borrowed from the status palette, which would misread as coverage status.
const HEAT_RAMP = [
  "interpolate", ["linear"], ["heatmap-density"],
  0, "rgba(27,138,143,0)",
  0.1, "rgba(27,138,143,0)",
  0.3, "#123B3D",
  0.5, "#1B8A8F",
  0.75, "#2DE0E6",
  1, "#D8FFFE",
] as const;

/** Customer density, drawn by MapLibre's own heatmap layer on the GPU. */
export default function HeatmapLayer({
  customers,
  weightByDebt,
  beforeId,
}: {
  customers: CustomerRow[];
  weightByDebt: boolean;
  beforeId?: string;
}) {
  const data = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(() => ({
    type: "FeatureCollection",
    features: customers
      .filter((c) => c.lat && c.lng)
      .map((c) => ({
        type: "Feature",
        properties: {
          weight: weightByDebt
            ? (c.debt?.bucket_30_plus ?? 0) > 0
              ? 1
              : (c.debt?.bucket_8_30 ?? 0) > 0
                ? 0.6
                : 0.25
            : 0.5,
        },
        geometry: { type: "Point", coordinates: [c.lng as number, c.lat as number] },
      })),
  }), [customers, weightByDebt]);

  return (
    <Source id="heatmap" type="geojson" data={data}>
      <Layer
        id="heatmap"
        type="heatmap"
        beforeId={beforeId}
        paint={{
          "heatmap-weight": ["get", "weight"],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 10, 14, 15, 30],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 10, 1, 15, 2],
          "heatmap-color": HEAT_RAMP as unknown as ExpressionSpecification,
          "heatmap-opacity": 0.85,
        }}
      />
    </Source>
  );
}
