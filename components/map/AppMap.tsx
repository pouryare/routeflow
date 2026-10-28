"use client";

import { useMemo, useState, useSyncExternalStore, type Ref } from "react";
import Map, { NavigationControl, type MapProps, type MapRef } from "@vis.gl/react-maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { useTheme } from "@/components/ThemeToggle";
import { BASEMAP_KEY, BASEMAPS_KEY, basemapDef, parseBasemaps, type BasemapId } from "@/lib/mapLayers";
import { protomapsStyle } from "@/lib/mapStyle";

/* MapLibre 6 runs its tile work in a separate worker file that it looks for next to its own
   module. A bundled app has no such neighbour, so the worker is handed to the bundler as an
   asset (hashed, cached for good) and its URL given to MapLibre before the first map. */
const mapLib =
  typeof window === "undefined"
    ? undefined
    : import("maplibre-gl").then((m) => {
        m.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);
        return m;
      });

const subscribe = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};
const readPreferences = () => {
  try { return JSON.stringify([localStorage.getItem(BASEMAPS_KEY), localStorage.getItem(BASEMAP_KEY)]); }
  catch { return "[null,null]"; }
};

/** Every map in the app: MapLibre over the self-hosted Protomaps basemap.
 *
 *  The ground is the basemap chosen on /map for the current skin, or `basemap` when the
 *  map keeps its own choice (the coverage map). Rotation and tilt are off: a sales map
 *  read north-up is easier to match against the street, and a stray two-finger twist
 *  should not turn it.
 *
 *  MapLibre needs WebGL. A phone without it gets a sentence instead of a blank box. */
export default function AppMap({
  basemap,
  zoomButtons = true,
  ref,
  children,
  ...props
}: Omit<MapProps, "mapStyle"> & { basemap?: BasemapId; zoomButtons?: boolean; ref?: Ref<MapRef> }) {
  const [skin] = useTheme();
  const preferences = useSyncExternalStore(subscribe, readPreferences, () => "[null,null]");
  const [raw, legacy] = JSON.parse(preferences) as [string | null, string | null];
  const active = basemapDef(basemap ?? parseBasemaps(raw, legacy)[skin]);
  const style = useMemo(
    () => protomapsStyle(active.flavor, window.location.origin, { labels: active.hasLabels }),
    [active.flavor, active.hasLabels],
  );
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div role="status" className="flex h-full w-full items-center justify-center bg-surface-2 p-4 text-center text-[length:var(--text-sm)] text-text-muted">
        نقشه روی این مرورگر باز نمی‌شود (WebGL در دسترس نیست). مرورگر را به‌روز کنید یا از Chrome استفاده کنید.
      </div>
    );
  }
  return (
    <Map
      {...props}
      ref={ref}
      mapLib={mapLib}
      mapStyle={style}
      dragRotate={false}
      pitchWithRotate={false}
      touchPitch={false}
      attributionControl={{ compact: true }}
      onLoad={(e) => {
        e.target.touchZoomRotate.disableRotation();
        props.onLoad?.(e);
      }}
      onError={(e) => {
        // No map at all (no WebGL, chunk failed). A tile that failed is only a blank square.
        if (!e.target) setFailed(true);
        props.onError?.(e);
      }}
    >
      {zoomButtons && <NavigationControl position="top-left" showCompass={false} />}
      {children}
    </Map>
  );
}
