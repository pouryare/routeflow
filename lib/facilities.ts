// Our own fixed sites -- the depots stock is dispatched from -- as opposed to customers
// (imported from the workbook), leads (pasted links) or districts (coverage polygons).
// Deliberately a constant rather than a DB table: there are two of them, they don't
// change from one week to the next, and a table would drag a migration, an API route,
// a permissions story and an editor UI behind it for data that a code edit expresses
// perfectly well. If sites ever become something the user adds and moves themselves,
// promote this shape to saved_locations-style storage -- FacilityKind is already the
// discriminator that move would need.
export type FacilityKind = "warehouse" | "home_base";

export interface Facility {
  id: string;
  kind: FacilityKind;
  /** Persian display name -- what the popup titles and the legend show. */
  name: string;
  /** Address as Google resolved it, or null when the pin was a bare dropped point. */
  address: string | null;
  lat: number;
  lng: number;
  /** The original share link, kept so the pin can always be re-verified at its source. */
  mapsUrl: string;
  note: string | null;
}

// Facilities carry no coverage/debt/activity state, so none of MASTER.md's semantic
// status colors (--good/--warn/--crit/--neutral) may describe them, and --accent is
// reserved for interactive UI. They get their own token instead: --facility, an ice
// white that reads on a radar console as "friendly asset, not a reading". Duplicated
// as literal hex for the same reason STATUS_COLOR is -- Leaflet writes marker colors
// straight into inline styles, where var() would resolve inconsistently.
export const FACILITY_COLOR = "#D6E6F5";

// The role each kind plays, not its name -- the popup prints the name as its title
// directly above this line, so a label that repeats it says nothing.
export const FACILITY_LABEL: Record<FacilityKind, string> = {
  warehouse: "انبار — منبع تأمین موجودی",
  home_base: "مبدأ توزیع — شروع مسیر روزانه",
};

export const FACILITIES: Facility[] = [
  {
    id: "warehouse-bakeh",
    kind: "warehouse",
    name: "انبار مرکزی",
    address: "استان تهران، بکه، بلوار رسول اکرم، املاک طاها",
    lat: 35.502669,
    lng: 51.7546255,
    mapsUrl: "https://maps.app.goo.gl/XYd819ZQiGJzHNKM9",
    note: "انبار اصلی — تأمین موجودی",
  },
  {
    id: "home-pardis",
    kind: "home_base",
    name: "خانه (انبار کوچک)",
    address: "تهران، پردیس، فاز ۲، خیابان فهمیده",
    lat: 35.753263,
    lng: 51.798381,
    mapsUrl: "https://maps.app.goo.gl/ivx6yY69Zb9S9sKu6",
    note: "شروع مسیر توزیع روزانه از اینجاست",
  },
];

/** The site every delivery run starts from. Non-null by construction -- the array above
 *  always carries exactly one home_base -- but typed nullable so a future edit that
 *  removes it fails at the call sites instead of at runtime. */
export function homeBase(): Facility | null {
  return FACILITIES.find((f) => f.kind === "home_base") ?? null;
}

export function mainWarehouse(): Facility | null {
  return FACILITIES.find((f) => f.kind === "warehouse") ?? null;
}
