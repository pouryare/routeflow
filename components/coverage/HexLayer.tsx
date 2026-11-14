"use client";

import { useEffect, useMemo, useState } from "react";
import { Layer, Popup, Source, useMap } from "@vis.gl/react-maplibre";
import type { MapLayerMouseEvent } from "maplibre-gl";
import { hexCenter, hexPolygon, hexSteps, type HexCell } from "@/lib/h3";
import type { HexMetric } from "@/lib/repo/hexMap";
import { faNum, faToman } from "@/lib/format";

/** One hue, light to dark (a quantity, so a sequential ramp, never a rainbow); the same teal family as the heat map. */
export const HEX_RAMP = ["#CFEFF0", "#8FD3D6", "#4DB5BA", "#1B8A8F", "#0F5558"];
const LAYER = "hex-fill";

export function hexValueText(metric: HexMetric, c: HexCell): string {
  return metric === "revenue" ? `${faToman(c.value)} · ${faNum(c.count)} مشتری` : `${faNum(c.count)} ${metric === "leads" ? "سرنخ" : "مشتری"}`;
}

/** The city's honeycomb: each cell coloured by how much it holds, a tap names the cell's number. */
export default function HexLayer({ cells, metric, beforeId }: { cells: HexCell[]; metric: HexMetric; beforeId?: string }) {
  const { current: map } = useMap();
  const [picked, setPicked] = useState<{ cell: HexCell; lng: number; lat: number } | null>(null);

  const data = useMemo<GeoJSON.FeatureCollection<GeoJSON.Polygon>>(() => {
    const steps = hexSteps(cells.map((c) => c.value), HEX_RAMP.length);
    return {
      type: "FeatureCollection",
      features: cells.map((c, i) => ({
        type: "Feature",
        properties: { h3: c.h3, fill: HEX_RAMP[steps[i]] },
        geometry: hexPolygon(c.h3),
      })),
    };
  }, [cells]);

  useEffect(() => {
    if (!map) return;
    const click = (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.h3 as string | undefined;
      const cell = cells.find((c) => c.h3 === id);
      if (cell) setPicked({ cell, ...hexCenter(cell.h3) });
    };
    map.on("click", LAYER, click);
    return () => {
      map.off("click", LAYER, click);
    };
  }, [map, cells]);

  return (
    <>
      <Source id="hex" type="geojson" data={data}>
        <Layer id={LAYER} type="fill" beforeId={beforeId} paint={{ "fill-color": ["get", "fill"], "fill-opacity": 0.6, "fill-outline-color": "#0F5558" }} />
      </Source>
      {picked && (
        <Popup longitude={picked.lng} latitude={picked.lat} closeButton onClose={() => setPicked(null)}>
          <span dir="rtl" className="text-[length:var(--text-sm)]">{hexValueText(metric, picked.cell)}</span>
        </Popup>
      )}
    </>
  );
}
