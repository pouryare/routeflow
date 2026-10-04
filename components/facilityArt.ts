// Leaflet-free half of the facility marker: the SVG silhouettes and a plain-DOM
// renderer for them. Kept apart from facilityIcon.ts because that module imports
// leaflet at top level, which touches `window` -- any page importing it cannot be
// prerendered. The sites editor needs the silhouettes but no map, so it imports here.
import { defaultIconFor, type FacilityKind } from "@/lib/facilityTypes";

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
// "other" used to reuse the warehouse silhouette, on the reasoning that a third form for a
// kind with no distinct meaning "would add a symbol the legend has to teach for no gain".
// That was right when the icon was derived from the kind -- there, `other` meant "some
// kind we do not model", and the warehouse was as good a guess as any. It is wrong now,
// for one reason: `other` is what a person picks when nothing fits, so it must not be drawn
// as the most common thing that did fit. It gets its own neutral pin.
export const FACILITY_ART: Record<string, { html: string; size: [number, number]; anchor: [number, number] }> = {
  "pin-glyph": {
    html: `<svg width="26" height="29" viewBox="0 0 26 29" aria-hidden="true">
        <path class="facility-marker__body" d="M13 1.2 24.2 7.7v13L13 27.2 1.8 20.7v-13z"/>
        <circle class="facility-marker__glyph" cx="13" cy="14.5" r="3.4"/>
      </svg>`,
    size: [26, 29],
    anchor: [13, 15],
  },
  "marker-glyph": {
    html: `<svg width="26" height="29" viewBox="0 0 26 29" aria-hidden="true">
        <path class="facility-marker__body" d="M13 1.2 24.2 7.7v13L13 27.2 1.8 20.7v-13z"/>
        <rect class="facility-marker__glyph" x="8.6" y="10.1" width="8.8" height="8.8" rx="1.6"/>
      </svg>`,
    size: [26, 29],
    anchor: [13, 15],
  },
  "factory-glyph": {
    html: `<svg width="26" height="29" viewBox="0 0 26 29" aria-hidden="true">
        <path class="facility-marker__body" d="M13 1.2 24.2 7.7v13L13 27.2 1.8 20.7v-13z"/>
        <path class="facility-marker__glyph" d="M7 19.4v-5.2l3.2 2.4v-2.4l3.2 2.4v-2.4l3.2 2.4v5.2z"/>
        <rect class="facility-marker__glyph" x="16.2" y="8.4" width="2.2" height="5" rx="0.5"/>
      </svg>`,
    size: [26, 29],
    anchor: [13, 15],
  },
  gear: {
    html: `<svg width="26" height="29" viewBox="0 0 26 29" aria-hidden="true">
        <path class="facility-marker__body" d="M13 1.2 24.2 7.7v13L13 27.2 1.8 20.7v-13z"/>
        <circle class="facility-marker__glyph" cx="13" cy="14.5" r="4.6"/>
        <circle cx="13" cy="14.5" r="1.9" fill="var(--facility, #D6E6F5)"/>
      </svg>`,
    size: [26, 29],
    anchor: [13, 15],
  },
  "van-glyph": {
    html: `<svg width="26" height="29" viewBox="0 0 26 29" aria-hidden="true">
        <path class="facility-marker__body" d="M13 1.2 24.2 7.7v13L13 27.2 1.8 20.7v-13z"/>
        <path class="facility-marker__glyph" d="M6.6 12.2h7.2v6.4H6.6zM14.6 14.2h3.2l2.4 2.4v2H14.6z"/>
        <circle cx="9.2" cy="20" r="1.5"/><circle cx="17" cy="20" r="1.5"/>
      </svg>`,
    size: [26, 29],
    anchor: [13, 15],
  },
  "truck-glyph": {
    html: `<svg width="26" height="29" viewBox="0 0 26 29" aria-hidden="true">
        <path class="facility-marker__body" d="M13 1.2 24.2 7.7v13L13 27.2 1.8 20.7v-13z"/>
        <rect class="facility-marker__glyph" x="6" y="12.6" width="14.6" height="5.8" rx="0.8"/>
        <circle cx="9.2" cy="20" r="1.5"/><circle cx="17.4" cy="20" r="1.5"/>
      </svg>`,
    size: [26, 29],
    anchor: [13, 15],
  },
  "house-glyph": {
    html: `<svg width="24" height="26" viewBox="0 0 24 26" aria-hidden="true">
        <path class="facility-marker__body" d="M12 1.8 22 9.4v12.4a1.6 1.6 0 0 1-1.6 1.6H3.6A1.6 1.6 0 0 1 2 21.8V9.4z"/>
        <rect class="facility-marker__glyph" x="9.4" y="13.6" width="5.2" height="7.2" rx="0.6"/>
      </svg>`,
    size: [24, 26],
    anchor: [12, 24],
  },
  "apartment-glyph": {
    html: `<svg width="24" height="26" viewBox="0 0 24 26" aria-hidden="true">
        <path class="facility-marker__body" d="M12 1.8 22 9.4v12.4a1.6 1.6 0 0 1-1.6 1.6H3.6A1.6 1.6 0 0 1 2 21.8V9.4z"/>
        <rect class="facility-marker__glyph" x="7.4" y="9.6" width="3.4" height="3.4" rx="0.5"/>
        <rect class="facility-marker__glyph" x="13.2" y="9.6" width="3.4" height="3.4" rx="0.5"/>
        <rect class="facility-marker__glyph" x="7.4" y="15.4" width="3.4" height="3.4" rx="0.5"/>
        <rect class="facility-marker__glyph" x="13.2" y="15.4" width="3.4" height="3.4" rx="0.5"/>
      </svg>`,
    size: [24, 26],
    anchor: [12, 24],
  },
  "office-glyph": {
    html: `<svg width="26" height="29" viewBox="0 0 26 29" aria-hidden="true">
        <path class="facility-marker__body" d="M13 1.2 24.2 7.7v13L13 27.2 1.8 20.7v-13z"/>
        <rect class="facility-marker__glyph" x="7.4" y="8.8" width="4" height="4" rx="0.5"/>
        <rect class="facility-marker__glyph" x="14.6" y="8.8" width="4" height="4" rx="0.5"/>
        <rect class="facility-marker__glyph" x="7.4" y="15.2" width="4" height="4" rx="0.5"/>
        <rect class="facility-marker__glyph" x="14.6" y="15.2" width="4" height="4" rx="0.5"/>
      </svg>`,
    size: [26, 29],
    anchor: [13, 15],
  },
  "desk-glyph": {
    html: `<svg width="26" height="29" viewBox="0 0 26 29" aria-hidden="true">
        <path class="facility-marker__body" d="M13 1.2 24.2 7.7v13L13 27.2 1.8 20.7v-13z"/>
        <rect class="facility-marker__glyph" x="6.2" y="14.6" width="13.6" height="2.2" rx="0.6"/>
        <rect class="facility-marker__glyph" x="7.6" y="16.8" width="1.9" height="3.4" rx="0.4"/>
        <rect class="facility-marker__glyph" x="16.5" y="16.8" width="1.9" height="3.4" rx="0.4"/>
        <rect class="facility-marker__glyph" x="10.4" y="8.8" width="5.2" height="4.2" rx="0.5"/>
      </svg>`,
    size: [26, 29],
    anchor: [13, 15],
  },
  "shopfront-glyph": {
    html: `<svg width="26" height="29" viewBox="0 0 26 29" aria-hidden="true">
        <path class="facility-marker__body" d="M13 1.2 24.2 7.7v13L13 27.2 1.8 20.7v-13z"/>
        <path class="facility-marker__glyph" d="M6.4 10.4h13.2l-1.3 3.4H7.7z"/>
        <rect class="facility-marker__glyph" x="7.7" y="15.6" width="10.6" height="4.4" rx="0.5"/>
      </svg>`,
    size: [26, 29],
    anchor: [13, 15],
  },
  "shelf-glyph": {
    html: `<svg width="26" height="29" viewBox="0 0 26 29" aria-hidden="true">
        <path class="facility-marker__body" d="M13 1.2 24.2 7.7v13L13 27.2 1.8 20.7v-13z"/>
        <rect class="facility-marker__glyph" x="6.6" y="10.4" width="12.8" height="1.9" rx="0.4"/>
        <rect class="facility-marker__glyph" x="6.6" y="15" width="12.8" height="1.9" rx="0.4"/>
        <rect class="facility-marker__glyph" x="6.6" y="19.6" width="12.8" height="1.9" rx="0.4"/>
      </svg>`,
    size: [26, 29],
    anchor: [13, 15],
  },
  snowflake: {
    html: `<svg width="26" height="29" viewBox="0 0 26 29" aria-hidden="true">
        <path class="facility-marker__body" d="M13 1.2 24.2 7.7v13L13 27.2 1.8 20.7v-13z"/>
        <path class="facility-marker__glyph" d="M13 8.4v12.2M7.9 11.3l10.2 6.4M18.1 11.3l-10.2 6.4"
          stroke-width="1.8" stroke-linecap="round" fill="none"/>
      </svg>`,
    size: [26, 29],
    anchor: [13, 15],
  },
  "cold-room-glyph": {
    html: `<svg width="26" height="29" viewBox="0 0 26 29" aria-hidden="true">
        <path class="facility-marker__body" d="M13 1.2 24.2 7.7v13L13 27.2 1.8 20.7v-13z"/>
        <path class="facility-marker__glyph" d="M6.8 19.6V11l6.2-3 6.2 3v8.6z"/>
        <rect class="facility-marker__glyph" x="11.4" y="14.4" width="3.2" height="5.2" rx="0.5"/>
      </svg>`,
    size: [26, 29],
    anchor: [13, 15],
  },
  "parking-glyph": {
    html: `<svg width="26" height="29" viewBox="0 0 26 29" aria-hidden="true">
        <path class="facility-marker__body" d="M13 1.2 24.2 7.7v13L13 27.2 1.8 20.7v-13z"/>
        <path class="facility-marker__glyph" d="M10 20.6V8.8h3.5a3.5 3.5 0 0 1 0 7h-3.5" stroke-width="2.2"
          stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      </svg>`,
    size: [26, 29],
    anchor: [13, 15],
  },
  "garage-glyph": {
    html: `<svg width="26" height="29" viewBox="0 0 26 29" aria-hidden="true">
        <path class="facility-marker__body" d="M13 1.2 24.2 7.7v13L13 27.2 1.8 20.7v-13z"/>
        <path class="facility-marker__glyph" d="M6.6 19.8V13l6.4-3.6 6.4 3.6v6.8z"/>
        <rect class="facility-marker__glyph" x="8.4" y="13.4" width="9.2" height="1.6" rx="0.4"/>
        <rect class="facility-marker__glyph" x="8.4" y="16.4" width="9.2" height="1.6" rx="0.4"/>
      </svg>`,
    size: [26, 29],
    anchor: [13, 15],
  },
  crates: {
    html: `<svg width="26" height="29" viewBox="0 0 26 29" aria-hidden="true">
        <path class="facility-marker__body" d="M13 1.2 24.2 7.7v13L13 27.2 1.8 20.7v-13z"/>
        <rect class="facility-marker__glyph" x="10.4" y="9.6" width="5.2" height="4.6" rx="0.6"/>
        <rect class="facility-marker__glyph" x="7.1" y="15.2" width="5.2" height="4.6" rx="0.6"/>
        <rect class="facility-marker__glyph" x="13.7" y="15.2" width="5.2" height="4.6" rx="0.6"/>
      </svg>`,
    size: [26, 29],
    anchor: [13, 15],
  },
  silo: {
    html: `<svg width="26" height="29" viewBox="0 0 26 29" aria-hidden="true">
        <path class="facility-marker__body" d="M13 1.2 24.2 7.7v13L13 27.2 1.8 20.7v-13z"/>
        <rect class="facility-marker__glyph" x="9.4" y="9" width="7.2" height="11" rx="3.6"/>
      </svg>`,
    size: [26, 29],
    anchor: [13, 15],
  },
};

/** Resolve a place to its silhouette.
 *
 *  `icon_key` is the person's choice and may be NULL, may name a shape that no longer
 *  exists, or may belong to a different kind than the row now says (the kind can be edited
 *  after the icon was chosen). All three fall back to the kind's first option rather than
 *  throwing -- a marker that cannot be drawn is worse than a marker that is slightly wrong. */
export function artFor(iconKey: string | null | undefined, kind: FacilityKind) {
  return FACILITY_ART[iconKey ?? ""] ?? FACILITY_ART[defaultIconFor(kind)] ?? FACILITY_ART["pin-glyph"];
}

/** The marker's outer element, without Leaflet. The map sidebar's legend and the sites
 *  editor both need the same silhouette at the same size in plain DOM -- teaching the
 *  reader a shape they will then look for on the map only works if it is the identical
 *  shape, so both render from this one function rather than re-describing it.
 *
 *  Only the HOME body is a different outline: a house that floats above the point it marks
 *  reads as hovering next to the address rather than standing on it, so it anchors at its
 *  base instead of its centre. Every other silhouette shares the hexagon. */
export function facilityMarkerHtml(iconKey: string | null | undefined, kind: FacilityKind): string {
  const art = artFor(iconKey, kind);
  const home = art.size[0] === 24;
  return `<span class="facility-marker${home ? " facility-marker--home" : ""}">${art.html}</span>`;
}

