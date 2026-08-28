"use client";

/** A MapLibre GL style drawn as a Leaflet layer.
 *
 *  CARTO's raster basemaps are watermarked without a paid plan, but their GL styles are
 *  free and unauthenticated -- so «رادار» is the genuine pre-redesign Dark Matter rather
 *  than a filter approximating it. Reaching those styles means a vector renderer.
 *
 *  This whole module (and the ~250KB of MapLibre with it) is behind a next/dynamic import
 *  in CoverageMap, so a driver who never leaves a raster basemap never downloads it.
 *
 *  Leaflet stays the map. maplibre-gl-leaflet mounts the GL canvas as one more Leaflet
 *  layer under the existing panes, which is what keeps every marker, district polygon,
 *  corridor band and popup working untouched.
 */

import { useEffect } from "react";
import { useMap } from "react-leaflet";
import type { Layer } from "leaflet";
import "maplibre-gl/dist/maplibre-gl.css";

export default function VectorBasemap({
  styleUrl,
  attribution,
  onError,
}: {
  styleUrl: string;
  attribution: string;
  /** Called when the GL layer cannot be created or its style fails to load, so the map
   *  can put the raster fallback up instead of showing an empty ground. */
  onError: () => void;
}) {
  const map = useMap();

  useEffect(() => {
    let cancelled = false;
    let layer: Layer | null = null;

    (async () => {
      try {
        const maplibregl = (await import("maplibre-gl")).default;
        // The Leaflet bridge reads the renderer off the global rather than importing it,
        // so this assignment has to happen before the plugin module is evaluated.
        (window as unknown as { maplibregl: unknown }).maplibregl = maplibregl;
        await import("@maplibre/maplibre-gl-leaflet");
        const L = (await import("leaflet")).default;

        if (cancelled) return;

        // A device with no working WebGL context throws here rather than rendering blank.
        layer = (
          L as unknown as {
            maplibreGL: (o: Record<string, unknown>) => Layer;
          }
        ).maplibreGL({ style: styleUrl, attribution });

        layer.addTo(map);

        // A style that 404s or a GPU that dies mid-session surfaces here, not as a throw.
        const gl = (layer as unknown as { getMaplibreMap?: () => { on: (e: string, f: () => void) => void } })
          .getMaplibreMap?.();
        gl?.on("error", () => {
          if (!cancelled) onError();
        });
      } catch {
        if (!cancelled) onError();
      }
    })();

    return () => {
      cancelled = true;
      if (layer) map.removeLayer(layer);
    };
  }, [map, styleUrl, attribution, onError]);

  return null;
}
