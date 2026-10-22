"use client";

import { TileLayer } from "react-leaflet";
import { QUIET_TILES } from "@/lib/mapLayers";

/** The calm raster basemap the small maps share (leads, planner, import). One definition, so a change to
 *  the quiet tiles reaches every map at once.
 *
 *  Fields named, never spread. QUIET_TILES carries `subdomains: undefined`, and Leaflet's _getSubdomain
 *  reads `.length` off whatever it is handed: spreading the object passes that undefined straight through
 *  and throws "Cannot read properties of undefined (reading 'length')" on the first tile request, which
 *  unmounts the whole page. */
export default function QuietTileLayer() {
  return (
    <TileLayer
      url={QUIET_TILES.url}
      attribution={QUIET_TILES.attribution}
      className="tiles-quiet"
      maxZoom={QUIET_TILES.maxZoom}
    />
  );
}
