"use client";
import { useEffect } from "react";
import { Marker, useMap } from "@vis.gl/react-maplibre";
import AppMap from "@/components/map/AppMap";

/** Keeps a changed pin in view without changing the zoom the user chose. */
function FollowPin({ picked }: { picked?: [number, number] | null }) {
  const { current: map } = useMap();
  const lat = picked?.[0], lng = picked?.[1];
  useEffect(() => {
    if (map && lat !== undefined && lng !== undefined) map.jumpTo({ center: [lng, lat] });
  }, [map, lat, lng]);
  return null;
}

/** Saved pin on the same theme-aware basemap as /map. Read-only preview by default;
 *  `interactive` with `onPick` lets the editor drop the pin with a tap. */
export default function CustomerLocationMap({ lat, lng, name, interactive = false, picked, onPick }: {
  lat: number; lng: number; name: string; interactive?: boolean;
  /** Overrides the pin position without changing the map view once the pin exists. */
  picked?: [number, number] | null;
  onPick?: (lat: number, lng: number) => void;
}) {
  // Read once, on mount: later pin moves pan via FollowPin and keep the user's zoom.
  const start = picked ?? [lat, lng];
  const pin = picked === undefined ? [lat, lng] : picked;
  return (
    <div className="customer-map" role="region" aria-label={`نقشهٔ موقعیت ${name}`}
      // Panning inside a lead-flow map is not a swipe to dismiss its parent sheet.
      onTouchStart={(e) => e.stopPropagation()}>
      <AppMap
        initialViewState={{ latitude: start[0], longitude: start[1], zoom: 16 }}
        interactive={interactive}
        zoomButtons={interactive}
        onClick={onPick ? (e) => onPick(e.lngLat.lat, e.lngLat.lng) : undefined}
      >
        {pin && (
          <Marker longitude={pin[1]} latitude={pin[0]} anchor="bottom">
            <div className="customer-pin" title={name} />
          </Marker>
        )}
        <FollowPin picked={picked} />
      </AppMap>
    </div>
  );
}
