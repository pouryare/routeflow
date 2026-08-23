// Client-safe half of the district-geometry contract: the tier names, the zoom at which
// "auto" flips between them, and the URL both sides must agree on. Kept apart from
// lib/districtGeometry.ts so a client component can import it without dragging
// node:zlib and the SQLite handle into the browser bundle.

export type PrecisionTier = "low" | "high";

export function isPrecisionTier(v: string | null | undefined): v is PrecisionTier {
  return v === "low" || v === "high";
}

/** The "low" tier decimates to a ~33m tolerance. That is under 2 CSS pixels at zoom 13
 *  and about 3.5 at zoom 14, so 14 is where the shortcuts would start being visible and
 *  the auto mode upgrades. */
export const PRECISION_AUTO_ZOOM = 14;

export function geometryUrl(version: string, tier: PrecisionTier): string {
  return `/api/districts/geometry?v=${version}&p=${tier}`;
}

/** What the sidebar offers. "auto" is not a tier -- it resolves to one by zoom. */
export type PrecisionMode = PrecisionTier | "auto";

export function isPrecisionMode(v: string | null | undefined): v is PrecisionMode {
  return v === "auto" || isPrecisionTier(v);
}

export function resolveTier(mode: PrecisionMode, zoom: number): PrecisionTier {
  if (mode !== "auto") return mode;
  return zoom >= PRECISION_AUTO_ZOOM ? "high" : "low";
}
