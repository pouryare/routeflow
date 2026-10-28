import { layers, namedFlavor } from "@protomaps/basemaps";
import type { StyleSpecification } from "maplibre-gl";

/** The Protomaps looks the app offers. Each is a colour set over the same tiles. */
export type MapFlavor = "light" | "dark" | "white" | "grayscale" | "black";

export const OSM_ATTRIBUTION =
  '<a href="https://protomaps.com">Protomaps</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/* Labels draw with the app's own Peyda (Persian digits), from the files the app already
   serves, so no glyph server is needed and street names match the rest of the UI.
   MapLibre 6 shapes right-to-left text itself; no RTL plugin. Protomaps' italic (water
   names) maps to the regular face, since Peyda has no italic. */
const REGULAR = "Peyda Regular";
const BOLD = "Peyda Medium";

/** The basemap's first label layer, the same in every flavour. App data that should sit
 *  under the street names (district fills, zones, the corridor) is drawn before it. */
export const BASEMAP_LABELS = "address_label";

/** A MapLibre style drawn entirely from this server: tiles from /api/map/tiles, sprites
 *  from /map/sprites, fonts from /fonts. `origin` is the page's own, since MapLibre's
 *  worker needs absolute URLs. */
export function protomapsStyle(flavor: MapFlavor, origin: string, opts: { labels?: boolean } = {}): StyleSpecification {
  const colours = { ...namedFlavor(flavor), regular: REGULAR, bold: BOLD, italic: REGULAR };
  const all = layers("protomaps", colours, { lang: "fa" });
  const dark = flavor === "dark" || flavor === "black";
  return {
    version: 8,
    sprite: `${origin}/map/sprites/${dark ? "dark" : "light"}`,
    "font-faces": {
      [REGULAR]: [{ url: `${origin}/fonts/PeydaFaNumWeb-Regular.woff2` }],
      [BOLD]: [{ url: `${origin}/fonts/PeydaFaNumWeb-Medium.woff2` }],
    },
    sources: {
      protomaps: {
        type: "vector",
        tiles: [`${origin}/api/map/tiles/{z}/{x}/{y}`],
        maxzoom: 15,
        attribution: OSM_ATTRIBUTION,
      },
    },
    // Hidden rather than removed, so BASEMAP_LABELS exists in every flavour.
    layers: opts.labels === false
      ? all.map((l) => (l.type === "symbol" ? { ...l, layout: { ...l.layout, visibility: "none" } } : l))
      : all,
  };
}
