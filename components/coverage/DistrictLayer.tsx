"use client";

import { useEffect, useMemo, useState } from "react";
import { Layer, Popup, Source, useMap } from "@vis.gl/react-maplibre";
import type { MapLayerMouseEvent } from "maplibre-gl";
import type { DistrictFeature } from "@/lib/types";
import { CLUSTER_LAYER, CUSTOMER_LAYER } from "./CustomerLayer";

/** How one district is painted. CoverageMap decides it (status or territory colour,
 *  selection, corridor dimming); this only carries it to the GPU. */
export interface DistrictPaint {
  fill: string;
  fillOpacity: number;
  line: string;
  lineWidth: number;
  lineOpacity: number;
  selected: boolean;
}

type Collection = { type: "FeatureCollection"; features: DistrictFeature[] };

const FILLS = ["mantaghe-fill", "mahalle-fill"];

/** The two district levels, mahalle over mantaghe, painted from per-feature properties so
 *  a recolour is one data update rather than a redraw of ~430 polygons. Drawn under the
 *  basemap's labels (`beforeId`), so street names stay readable through the fills. */
export default function DistrictLayer({
  mantaghe,
  mahalle,
  paint,
  tooltip,
  onPick,
  beforeId,
}: {
  mantaghe: Collection | null;
  mahalle: Collection | null;
  paint: (f: DistrictFeature) => DistrictPaint;
  tooltip: (f: DistrictFeature) => string;
  onPick: (f: DistrictFeature) => void;
  beforeId?: string;
}) {
  const { current: map } = useMap();
  const [hover, setHover] = useState<{ lng: number; lat: number; text: string } | null>(null);

  const painted = useMemo(() => {
    const dress = (c: Collection | null): GeoJSON.FeatureCollection | null =>
      c && {
        type: "FeatureCollection",
        features: c.features.map((f) => ({ ...f, properties: { ...f.properties, ...paint(f) } }) as unknown as GeoJSON.Feature),
      };
    return { mantaghe: dress(mantaghe), mahalle: dress(mahalle) };
  }, [mantaghe, mahalle, paint]);

  const byId = useMemo(() => {
    const m = new Map<number, DistrictFeature>();
    for (const f of [...(mantaghe?.features ?? []), ...(mahalle?.features ?? [])]) m.set(f.properties.id, f);
    return m;
  }, [mantaghe, mahalle]);

  useEffect(() => {
    if (!map) return;
    const onClick = (e: MapLayerMouseEvent) => {
      // A customer on top of a district is what was meant. Mahalle is drawn over mantaghe,
      // and the topmost feature comes first, so a small mahalle wins over its mantaghe.
      if (map.queryRenderedFeatures(e.point, { layers: [CUSTOMER_LAYER, CLUSTER_LAYER].filter((l) => map.getLayer(l)) }).length) return;
      const top = map.queryRenderedFeatures(e.point, { layers: FILLS.filter((l) => map.getLayer(l)) })[0];
      const f = top && byId.get(Number(top.properties.id));
      if (f) onPick(f);
    };
    // A hover card only where there is a hover; on a phone the tap opens the editor.
    const canHover = window.matchMedia?.("(hover: hover)").matches;
    const onMove = (e: MapLayerMouseEvent) => {
      const f = e.features?.[0] && byId.get(Number(e.features[0].properties.id));
      setHover(f ? { lng: e.lngLat.lng, lat: e.lngLat.lat, text: tooltip(f) } : null);
    };
    const onLeave = () => setHover(null);
    map.on("click", onClick);
    if (canHover) {
      map.on("mousemove", FILLS, onMove);
      map.on("mouseleave", FILLS, onLeave);
    }
    return () => {
      map.off("click", onClick);
      map.off("mousemove", FILLS, onMove);
      map.off("mouseleave", FILLS, onLeave);
    };
  }, [map, byId, onPick, tooltip]);

  const fill = { "fill-color": ["get", "fill"], "fill-opacity": ["get", "fillOpacity"] };
  const line = { "line-color": ["get", "line"], "line-width": ["get", "lineWidth"], "line-opacity": ["get", "lineOpacity"] };
  return (
    <>
      {(["mantaghe", "mahalle"] as const).map((level) =>
        painted[level] ? (
          <Source key={level} id={level} type="geojson" data={painted[level]!}>
            <Layer id={`${level}-fill`} type="fill" beforeId={beforeId} paint={fill as never} />
            <Layer id={`${level}-line`} type="line" beforeId={beforeId} filter={["!", ["get", "selected"]]} paint={line as never} />
            {/* A district picked for a bulk change gets a dashed outline on top. */}
            <Layer id={`${level}-picked`} type="line" beforeId={beforeId} filter={["get", "selected"]}
              paint={{ ...(line as object), "line-dasharray": [2, 1.5] } as never} />
          </Source>
        ) : null,
      )}
      {hover && (
        <Popup longitude={hover.lng} latitude={hover.lat} closeButton={false} closeOnClick={false} offset={12} className="map-tooltip">
          <span dir="rtl">{hover.text}</span>
        </Popup>
      )}
    </>
  );
}
