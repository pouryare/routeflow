"use client";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { useTheme } from "@/components/ThemeToggle";
import { BASEMAP_KEY, BASEMAPS_KEY, basemapDef, parseBasemaps, QUIET_TILES, type BasemapId } from "@/lib/mapLayers";

const VectorBasemap = dynamic(() => import("../VectorBasemap"), { ssr: false });
const subscribe = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};
const readPreferences = () => {
  try { return JSON.stringify([localStorage.getItem(BASEMAPS_KEY), localStorage.getItem(BASEMAP_KEY)]); }
  catch { return "[null,null]"; }
};

const pinIcon = L.divIcon({
  className: "",
  html: `<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:var(--accent);border:2px solid var(--accent-ink);box-shadow:0 2px 6px rgba(0,0,0,0.4)"></div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 22],
});

function PickCatcher({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: e => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

function MapLayout({ picked }: { picked?: [number, number] | null }) {
  const map = useMap();
  const lat = picked?.[0], lng = picked?.[1];
  useEffect(() => {
    // Leaflet caches its pixel size; sheet transitions and inline expansion change it.
    let frame = 0;
    const resize = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => map.invalidateSize({ pan: false })); };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    const container = map.getContainer();
    observer?.observe(container);
    // Panning inside a lead-flow map is not a swipe to dismiss its parent sheet.
    const stopSwipe = (event: TouchEvent) => event.stopPropagation();
    container.addEventListener("touchstart", stopSwipe, { passive: true });
    resize();
    return () => { observer?.disconnect(); cancelAnimationFrame(frame); container.removeEventListener("touchstart", stopSwipe); };
  }, [map]);
  useEffect(() => {
    if (lat !== undefined && lng !== undefined) map.setView([lat, lng], map.getZoom(), { animate: false });
  }, [map, lat, lng]);
  return null;
}

/** Saved pin on the same theme-aware basemap as /map, including its vector fallback.
 *  Read-only preview by default; optional picking and children (controls) for editing. */
export default function CustomerLocationMap({ lat, lng, name, interactive = false, picked, onPick, children }: {
  lat: number; lng: number; name: string; interactive?: boolean;
  /** Overrides the pin position without changing the map view once the pin exists. */
  picked?: [number, number] | null;
  onPick?: (lat: number, lng: number) => void;
  children?: React.ReactNode;
}) {
  const [skin] = useTheme();
  const preferences = useSyncExternalStore(subscribe, readPreferences, () => "[null,null]");
  const [raw, legacy] = JSON.parse(preferences) as [string | null, string | null];
  const active = basemapDef(parseBasemaps(raw, legacy)[skin]);
  const [failed, setFailed] = useState<ReadonlySet<BasemapId>>(new Set());
  const onError = useCallback(() => setFailed(prev => new Set(prev).add(active.id)), [active.id]);
  const vectorStyle = active.styleUrl && !failed.has(active.id) ? active.styleUrl : null;
  const tiles: Pick<typeof active, "url" | "attribution" | "subdomains" | "toneClass" | "maxZoom"> = active.styleUrl ? active.rasterFallback ?? QUIET_TILES : active;
  return (
    <MapContainer center={picked ?? [lat, lng]} zoom={16} dragging={interactive} scrollWheelZoom={interactive} doubleClickZoom={interactive} touchZoom={interactive} keyboard={interactive} zoomControl={interactive} className="customer-map" aria-label={`نقشهٔ موقعیت ${name}`}>
      {vectorStyle ? <VectorBasemap key={active.id} styleUrl={vectorStyle} attribution={active.attribution} onError={onError} /> : (
        <TileLayer key={`${active.id}-raster`} url={tiles.url} attribution={tiles.attribution} subdomains={tiles.subdomains ?? "abc"} className={tiles.toneClass} maxZoom={tiles.maxZoom} />
      )}
      {picked !== null && <Marker position={picked ?? [lat, lng]} icon={pinIcon} title={name} />}
      <MapLayout picked={picked} />
      {onPick && <PickCatcher onPick={onPick} />}
      {children}
    </MapContainer>
  );
}

