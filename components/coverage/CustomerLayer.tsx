"use client";

import { useEffect, useMemo, useState } from "react";
import { Layer, Popup, Source, useMap } from "@vis.gl/react-maplibre";
import type { GeoJSONSource, MapLayerMouseEvent } from "maplibre-gl";
import { shapeForColor, type CustomerRow } from "@/lib/types";
import type { MapInk } from "./mapInk";
import { MARKER_SHAPES, markerImage } from "./markerImages";

export const CUSTOMER_LAYER = "customers";
export const CLUSTER_LAYER = "customer-clusters";

/** Every customer pin on the coverage map, drawn by MapLibre on the GPU and clustered.
 *
 *  Clustering stays on until street level, which is what makes coincident customers
 *  reachable at all: nearly half the geocoded customers share their exact coordinates with
 *  another one, because they were geocoded to an area rather than to a door. A bubble that
 *  no zoom can split opens a list of its members instead, the only way to reach them. */
export default function CustomerLayer({
  customers,
  colorOf,
  shaped,
  ink,
  onOpen,
}: {
  customers: (CustomerRow & { lat: number; lng: number })[];
  colorOf: (c: CustomerRow) => string;
  /** Shape by status as well as colour, for readers who cannot rely on colour. */
  shaped: boolean;
  ink: MapInk;
  onOpen: (c: CustomerRow) => void;
}) {
  const { current: map } = useMap();
  const [stack, setStack] = useState<{ lat: number; lng: number; members: (CustomerRow & { lat: number; lng: number })[] } | null>(null);

  // The shape images belong to the style, so they are added again after a basemap switch.
  useEffect(() => {
    if (!map) return;
    const add = () => {
      for (const shape of MARKER_SHAPES) {
        const id = `marker-${shape}`;
        if (!map.hasImage(id)) map.addImage(id, markerImage(shape), { sdf: true, pixelRatio: 2 });
      }
    };
    add();
    map.on("styledata", add);
    return () => {
      map.off("styledata", add);
    };
  }, [map]);

  const byId = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const data = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(() => ({
    type: "FeatureCollection",
    features: customers.map((c) => {
      const color = colorOf(c);
      return {
        type: "Feature",
        id: c.id,
        properties: { id: c.id, color, shape: shaped ? shapeForColor(color) : "diamond", name: c.business_name },
        geometry: { type: "Point", coordinates: [c.lng, c.lat] },
      };
    }),
  }), [customers, colorOf, shaped]);

  useEffect(() => {
    if (!map) return;
    const onClick = async (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f) return;
      if (f.layer.id === CUSTOMER_LAYER) {
        const c = byId.get(Number(f.properties.id));
        if (c) onOpen(c);
        return;
      }
      const source = map.getSource("customers") as GeoJSONSource | undefined;
      if (!source) return;
      const clusterId = Number(f.properties.cluster_id);
      const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
      const zoom = await source.getClusterExpansionZoom(clusterId);
      if (zoom <= map.getMaxZoom() && zoom <= 18) {
        map.easeTo({ center: [lng, lat], zoom });
        return;
      }
      const leaves = await source.getClusterLeaves(clusterId, 50, 0);
      setStack({ lat, lng, members: leaves.map((l) => byId.get(Number(l.properties?.id))).filter((c) => c !== undefined) });
    };
    map.on("click", CUSTOMER_LAYER, onClick);
    map.on("click", CLUSTER_LAYER, onClick);
    return () => {
      map.off("click", CUSTOMER_LAYER, onClick);
      map.off("click", CLUSTER_LAYER, onClick);
    };
  }, [map, byId, onOpen]);

  return (
    <>
      <Source id="customers" type="geojson" data={data} cluster clusterRadius={50} clusterMaxZoom={17}>
        <Layer
          id={CLUSTER_LAYER}
          type="circle"
          filter={["has", "point_count"]}
          paint={{
            "circle-color": ink.accent,
            "circle-radius": ["step", ["get", "point_count"], 15, 10, 18, 50, 22],
            "circle-stroke-width": 2,
            "circle-stroke-color": ink.bg,
          }}
        />
        <Layer
          id="customer-cluster-count"
          type="symbol"
          filter={["has", "point_count"]}
          // Peyda FaNum draws the count in Persian digits without any formatting here.
          layout={{ "text-field": ["get", "point_count_abbreviated"], "text-font": ["Peyda Medium"], "text-size": 12, "text-allow-overlap": true }}
          paint={{ "text-color": ink.accentInk }}
        />
        <Layer
          id={CUSTOMER_LAYER}
          type="symbol"
          filter={["!", ["has", "point_count"]]}
          layout={{ "icon-image": ["concat", "marker-", ["get", "shape"]], "icon-allow-overlap": true, "icon-ignore-placement": true }}
          paint={{ "icon-color": ["get", "color"], "icon-halo-color": ink.bg, "icon-halo-width": 2 }}
        />
      </Source>
      {stack && (
        <Popup longitude={stack.lng} latitude={stack.lat} offset={18} closeOnClick onClose={() => setStack(null)} maxWidth="260px">
          <ul dir="rtl" className="m-0 flex max-h-60 list-none flex-col overflow-y-auto p-0" aria-label="مشتری‌های این نقطه">
            {stack.members.map((c) => (
              <li key={c.id}>
                <button type="button" className="flex min-h-[44px] w-full items-center gap-2 text-right text-[length:var(--text-sm)] text-text"
                  onClick={() => { setStack(null); onOpen(c); }}>
                  {/* No icon: the coloured diamond is the customer's map pin, shown in miniature. */}
                  <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rotate-45 rounded-[2px]" style={{ background: colorOf(c) }} />
                  {c.business_name}
                </button>
              </li>
            ))}
          </ul>
        </Popup>
      )}
    </>
  );
}
