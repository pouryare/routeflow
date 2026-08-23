import { divIcon } from "leaflet";
import type { DivIcon } from "leaflet";
import type { FacilityKind } from "@/lib/facilityTypes";
import { FACILITY_ART } from "./facilityArt";

export { FACILITY_ART, facilityMarkerHtml } from "./facilityArt";

// Leaflet icons are stateless factories -- one instance can back every marker that looks
// alike -- so these are built once per kind and shared. This cache is separate from the
// customer-marker cache in CoverageMap: they key on different things and neither should
// be able to evict the other.
const iconCache = new Map<FacilityKind, DivIcon>();

export function facilityIcon(kind: FacilityKind): DivIcon {
  const cached = iconCache.get(kind);
  if (cached) return cached;

  const art = FACILITY_ART[kind];
  const icon = divIcon({
    className: "",
    html: `<div class="facility-marker${kind === "home_base" ? " facility-marker--home" : ""}">${art.html}</div>`,
    iconSize: art.size,
    iconAnchor: art.anchor,
  });
  iconCache.set(kind, icon);
  return icon;
}
