"use client";

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.heat";
import { CustomerRow } from "@/lib/types";

// Single-hue sequential ramp (dataviz skill: "sequential = one hue, light->dark,
// never a rainbow"). Low end recedes toward the dark bg, high end is the app's own
// --accent/--accent-dim tokens plus a near-white peak for the hottest spots --
// no unrelated hues borrowed from the status palette, which would misread as coverage status.
const HEAT_GRADIENT = {
  0.1: "rgba(27,138,143,0)",
  0.3: "#123B3D",
  0.5: "#1B8A8F",
  0.75: "#2DE0E6",
  1.0: "#D8FFFE",
};

export default function HeatmapLayer({
  customers,
  weightByDebt,
}: {
  customers: CustomerRow[];
  weightByDebt: boolean;
}) {
  const map = useMap();
  const layerRef = useRef<L.HeatLayer | null>(null);

  useEffect(() => {
    const points: [number, number, number][] = customers
      .filter((c) => c.lat && c.lng)
      .map((c) => {
        const weight = weightByDebt
          ? (c.debt?.bucket_30_plus ?? 0) > 0
            ? 1
            : (c.debt?.bucket_8_30 ?? 0) > 0
              ? 0.6
              : 0.25
          : 0.5;
        return [c.lat as number, c.lng as number, weight];
      });

    if (!layerRef.current) {
      layerRef.current = L.heatLayer(points, {
        radius: 22,
        blur: 20,
        maxZoom: 15,
        gradient: HEAT_GRADIENT,
      }).addTo(map);
    } else {
      layerRef.current.setLatLngs(points);
    }
  }, [customers, weightByDebt, map]);

  useEffect(() => {
    return () => {
      layerRef.current?.remove();
      layerRef.current = null;
    };
  }, [map]);

  return null;
}
