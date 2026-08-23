// Client-safe half of the facilities module: the row shape and the two constants that
// describe it, with no database import anywhere in its graph.
//
// This split is load-bearing, not tidiness. lib/facilities.ts reads SQLite, so anything
// importing a *value* from it drags node:sqlite into whatever bundle that importer
// belongs to -- and CoverageMap, a Client Component, needs FACILITY_LABEL. Turbopack
// fails the build outright on that ("the chunking context does not support external
// modules"), which is how this file came to exist. Server code imports readers from
// lib/facilities; client code imports types and labels from here.

export type FacilityKind = "warehouse" | "home_base" | "other";
export const FACILITY_KINDS: FacilityKind[] = ["warehouse", "home_base", "other"];

export interface FacilityRow {
  id: number;
  slug: string;
  kind: FacilityKind;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
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
  other: "مکان دیگر",
};
