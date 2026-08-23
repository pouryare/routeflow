// Leaflet-free half of the facility marker: the SVG silhouettes and a plain-DOM
// renderer for them. Kept apart from facilityIcon.ts because that module imports
// leaflet at top level, which touches `window` -- any page importing it cannot be
// prerendered. The sites editor needs the silhouettes but no map, so it imports here.
import type { FacilityKind } from "@/lib/facilityTypes";

// Our own sites are drawn as inline SVG silhouettes rather than emoji (MASTER.md's
// anti-pattern list) or a status-colored diamond: they carry no coverage reading, so
// reusing the customer marker's shape would invite the map to be misread.
//
// The warehouse's inner glyph is a stack of crates, not a building. A roof-and-door
// glyph was tried first and, at the 26px the marker actually renders at, read as a
// second little house sitting inside a hexagon -- indistinguishable at a glance from
// the home-base marker beside it in the legend, which defeats the whole point of
// separating the two by silhouette. Every fill lives in globals.css against
// --facility/--bg, so no color is duplicated here.
//
// The warehouse anchors at its center (a footprint, like the customer diamond); the
// house anchors at its base, because a house silhouette that floats above the point it
// marks reads as hovering next to the address rather than standing on it.
//
// "other" reuses the warehouse silhouette: it is the generic "a site of ours" shape,
// and inventing a third form for a kind with no distinct meaning would add a symbol the
// legend has to teach for no gain.
export const FACILITY_ART: Record<FacilityKind, { html: string; size: [number, number]; anchor: [number, number] }> = {
  warehouse: {
    html: `<svg width="26" height="29" viewBox="0 0 26 29" aria-hidden="true">
        <path class="facility-marker__body" d="M13 1.2 24.2 7.7v13L13 27.2 1.8 20.7v-13z"/>
        <rect class="facility-marker__glyph" x="10.4" y="9.6" width="5.2" height="4.6" rx="0.6"/>
        <rect class="facility-marker__glyph" x="7.1" y="15.2" width="5.2" height="4.6" rx="0.6"/>
        <rect class="facility-marker__glyph" x="13.7" y="15.2" width="5.2" height="4.6" rx="0.6"/>
      </svg>`,
    size: [26, 29],
    anchor: [13, 15],
  },
  home_base: {
    html: `<svg width="24" height="26" viewBox="0 0 24 26" aria-hidden="true">
        <path class="facility-marker__body" d="M12 1.8 22 9.4v12.4a1.6 1.6 0 0 1-1.6 1.6H3.6A1.6 1.6 0 0 1 2 21.8V9.4z"/>
        <rect class="facility-marker__glyph" x="9.4" y="13.6" width="5.2" height="7.2" rx="0.6"/>
      </svg>`,
    size: [24, 26],
    anchor: [12, 24],
  },
  other: {
    html: `<svg width="26" height="29" viewBox="0 0 26 29" aria-hidden="true">
        <path class="facility-marker__body" d="M13 1.2 24.2 7.7v13L13 27.2 1.8 20.7v-13z"/>
        <rect class="facility-marker__glyph" x="10.4" y="9.6" width="5.2" height="4.6" rx="0.6"/>
        <rect class="facility-marker__glyph" x="7.1" y="15.2" width="5.2" height="4.6" rx="0.6"/>
        <rect class="facility-marker__glyph" x="13.7" y="15.2" width="5.2" height="4.6" rx="0.6"/>
      </svg>`,
    size: [26, 29],
    anchor: [13, 15],
  },
};

/** The marker's outer element, without Leaflet. The map sidebar's legend and the sites
 *  editor both need the same silhouette at the same size in plain DOM -- teaching the
 *  reader a shape they will then look for on the map only works if it is the identical
 *  shape, so both render from this one function rather than re-describing it. */
export function facilityMarkerHtml(kind: FacilityKind): string {
  return `<span class="facility-marker${kind === "home_base" ? " facility-marker--home" : ""}">${FACILITY_ART[kind].html}</span>`;
}

