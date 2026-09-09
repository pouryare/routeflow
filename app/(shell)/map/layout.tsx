import type { ReactNode } from "react";

/** The map canvas keeps its own dark identity whatever skin the viewer chose.
 *
 *  Two thousand lines of map chrome -- cluster bubbles, zone fills, the corridor band,
 *  the names overlay -- are tuned for a near-black ground, and the basemaps themselves
 *  are dark. The header above it and every other surface still follow the viewer's skin;
 *  only what sits under this attribute is pinned. See app/globals.css,
 *  `.meridian [data-surface="map"]`.
 *
 *  /facilities and /gallery are deliberately NOT marked. MASTER.md's product-shape table
 *  groups them with the map, but neither renders a canvas -- one is a form list, the
 *  other a photo grid -- so darkening them under a light skin would be a bug dressed up
 *  as consistency.
 *
 *  Synchronous: nothing here reads runtime data, so it never blocks a navigation.
 */
export default function MapSurfaceLayout({ children }: { children: ReactNode }) {
  return <div data-surface="map">{children}</div>;
}
