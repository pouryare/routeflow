import { divIcon } from "leaflet";
import type { DivIcon } from "leaflet";
import type { FacilityKind } from "@/lib/facilityTypes";
import { artFor } from "./facilityArt";

export { FACILITY_ART, facilityMarkerHtml, artFor } from "./facilityArt";

// Leaflet icons are stateless factories -- one instance can back every marker that looks
// alike -- so these are built once per shape and shared. Keyed on the ICON, not the kind,
// because two places of the same kind can wear different shapes. This cache is separate
// from the customer-marker cache in CoverageMap: they key on different things and neither
// should be able to evict the other.
const iconCache = new Map<string, DivIcon>();

export function facilityIcon(kind: FacilityKind, iconKey?: string | null): DivIcon {
  const art = artFor(iconKey, kind);
  const cached = iconCache.get(art.html);
  if (cached) return cached;

  const home = art.size[0] === 24;
  const icon = divIcon({
    className: "",
    html: `<div class="facility-marker${home ? " facility-marker--home" : ""}">${art.html}</div>`,
    iconSize: art.size,
    iconAnchor: art.anchor,
  });
  iconCache.set(art.html, icon);
  return icon;
}
