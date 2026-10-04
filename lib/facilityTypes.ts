// Client-safe half of the facilities module: the row shape and the two constants that
// describe it, with no database import anywhere in its graph.
//
// This split is load-bearing, not tidiness. lib/facilities.ts reads SQLite, so anything
// importing a *value* from it drags node:sqlite into whatever bundle that importer
// belongs to -- and CoverageMap, a Client Component, needs FACILITY_LABEL. Turbopack
// fails the build outright on that ("the chunking context does not support external
// modules"), which is how this file came to exist. Server code imports readers from
// lib/facilities; client code imports types and labels from here.

/** The nine kinds a place can be.
 *
 *  `van` was missing from this list while the database allowed it and vanStock.ts had been
 *  inserting one all along -- so FacilityRow could not describe a van, the type system
 *  pretended vans did not exist, and every kind-keyed map was incomplete by construction.
 *
 *  `home` replaces `home_base`: "base" reads as a company camp, which is not what a
 *  driver's own house is. The column is renamed by migration; see spec 2 §5.
 *
 *  These are LABELS today, not behaviour. Every read of `kind` in the codebase asks one of
 *  two questions -- "which is the home base?" or "which is the depot?" -- and nothing asks
 *  about any other kind. A kind earns its place by helping a person scan a list, which is
 *  why the icon is chosen per facility (see icon_key) rather than derived from the kind. */
export type FacilityKind =
  | "warehouse"
  | "factory"
  | "van"
  | "home"
  | "office"
  | "shop"
  | "cold_storage"
  | "parking"
  | "other";

export const FACILITY_KINDS: FacilityKind[] = [
  "warehouse",
  "factory",
  "van",
  "home",
  "office",
  "shop",
  "cold_storage",
  "parking",
  "other",
];

export interface FacilityRow {
  id: number;
  slug: string;
  kind: FacilityKind;
  name: string;
  /** The silhouette this place is drawn with, chosen by the person who made it. NULL
   *  means "not chosen yet" and falls back to the kind's first option -- so a place
   *  created before this column existed still draws something sensible. */
  icon_key: string | null;
  address: string | null;
  /** Nullable: a place can be named before it has been put on the map. A reader that
   *  needs a position must SKIP an unplaced facility -- substituting 0,0 is how vans
   *  ended up drawn in the Gulf of Guinea. */
  lat: number | null;
  lng: number | null;
  maps_url: string | null;
  notes: string | null;
  /** SQLite has no boolean type -- 0 or 1. Exactly one row across the table holds 1;
   *  the invariant is enforced in PATCH /api/facilities/[id], not by an index. */
  is_default_origin: number;
  /** NULL means "shared by everyone". Nothing reads this yet -- it exists so that
   *  giving each driver their own origin later is a query change rather than a
   *  migration against a table that already holds real data. */
  owner_username: string | null;
  created_at: string;
  updated_at: string;
}

/** Has somebody actually put this place on the map?
 *
 *  A facility row can exist with no location: named but not yet dropped on a pin, a van
 *  nobody has parked, a home not yet entered. Anything that needs a *position* -- an
 *  origin to measure from, a pin to draw -- must ask this first. Substituting a default
 *  for a null is how every van ended up drawn at 0,0 in the Gulf of Guinea.
 *
 *  Lives here, not in lib/facilities.ts, because CoverageMap needs it and is a Client
 *  Component -- see the split note at the top of this file. */
export function isPlaced(f: FacilityRow): f is FacilityRow & { lat: number; lng: number } {
  return f.lat !== null && f.lng !== null;
}

/** The one place the origin fallback lives: flagged site, else home base, else first.
 *
 *  Only ever a place that HAS a location, and the filter runs BEFORE the ranking rather
 *  than after it -- ranking first and dropping an unplaced winner would return null
 *  precisely when the flagged site is the unplaced one, which is the case the fallback
 *  exists to cover.
 *
 *  Three call sites had this chain copy-pasted -- defaultOrigin, coverageAnalytics,
 *  CoverageMap -- which is how they came to disagree about which one counted as "first". */
export function pickOrigin(
  list: readonly FacilityRow[]
): (FacilityRow & { lat: number; lng: number }) | null {
  const placed = list.filter(isPlaced);
  return (
    placed.find((f) => f.is_default_origin === 1) ??
    placed.find((f) => f.kind === "home") ??
    placed[0] ??
    null
  );
}

/** The first place that HAS a location and also matches `test`.
 *
 *  Two steps rather than one combined predicate, because TypeScript only narrows when the
 *  type guard IS the predicate -- `list.filter((f) => isPlaced(f) && test(f))` keeps the
 *  wide type, and every caller then needs a runtime check the compiler cannot see is already
 *  done. Not generic: a generic T erases the narrowing, because T could be instantiated
 *  with a subtype whose lat is already nullable. */
export function pickPlaced(
  list: readonly FacilityRow[],
  test: (f: FacilityRow) => boolean
): (FacilityRow & { lat: number; lng: number }) | null {
  return list.filter(isPlaced).find(test) ?? null;
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
  factory: "کارخانه — تولید و ارسال به انبار",
  van: "ماشین — در حال سرویس",
  home: "مبدأ توزیع — شروع مسیر روزانه",
  office: "دفتر",
  shop: "فروشگاه",
  cold_storage: "سردخانه",
  parking: "پارکینگ — محل توقف ماشین‌ها",
  other: "مکان دیگر",
};

/** The shapes each kind offers, and which one a place gets when nobody has chosen.
 *
 *  The icon is the person's choice, not the kind's. That reversal matters for one concrete
 *  reason: it means adding a kind later leaves every already-chosen icon valid, instead of
 *  retroactively changing what every existing place of that kind looks like. The first
 *  entry per kind is the default, which is what a NULL icon_key falls back to. */
export const FACILITY_ICONS: Record<FacilityKind, string[]> = {
  warehouse: ["crates", "silo"],
  factory: ["factory-glyph", "gear"],
  van: ["van-glyph", "truck-glyph"],
  home: ["house-glyph", "apartment-glyph"],
  office: ["office-glyph", "desk-glyph"],
  shop: ["shopfront-glyph", "shelf-glyph"],
  cold_storage: ["snowflake", "cold-room-glyph"],
  parking: ["parking-glyph", "garage-glyph"],
  other: ["pin-glyph", "marker-glyph"],
};

export function defaultIconFor(kind: FacilityKind): string {
  return FACILITY_ICONS[kind]?.[0] ?? "pin-glyph";
}
