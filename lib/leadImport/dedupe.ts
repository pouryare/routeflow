// Deciding what to do with one freshly-resolved link.
//
// Split out of the runner and kept pure so the auto-add decision is testable without a
// database, a network or a browser. The runner supplies the coordinates; this decides the
// verdict, and the repo persists it.
//
// Auto-add writes a row nobody looked at, so the bar for "safe to save without asking"
// is deliberately high: an exact pin (lat/lng in the URL, a Plus Code, or a real Chromium
// page) and no duplicate signal. A Nominatim area match is a neighbourhood, not a venue,
// and a weak guess planted silently is worse than one surfaced for a human -- the user
// would never know to distrust it.

import { isAutoAddable } from "@/lib/leadImportMeta";
import { findDuplicate, type DuplicatePool } from "@/lib/duplicateDetection";
import type { LocationResolution } from "@/lib/db";

export type ItemVerdict = "add" | "duplicate" | "unresolved";

export interface VerdictInput {
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  resolution: LocationResolution;
  /** Everything already stored for this tenant. Loaded once per job, not per item. */
  pool: DuplicatePool[];
}

export interface Verdict {
  verdict: ItemVerdict;
  duplicateOf: "location" | "customer" | null;
  duplicateName: string | null;
}

export function decideItem(input: VerdictInput): Verdict {
  // No coordinates at all, whatever the method claimed: there is no pin to save.
  if (input.lat === null || input.lng === null) {
    return { verdict: "unresolved", duplicateOf: null, duplicateName: null };
  }

  const dup = findDuplicate(input.name, input.address, input.lat, input.lng, input.pool);
  if (dup) {
    return {
      verdict: "duplicate",
      duplicateOf: dup.existingKind,
      duplicateName: dup.existingName,
    };
  }

  if (!isAutoAddable(input.resolution)) {
    // Resolved to an area, not a venue. Keep it for a human rather than guess.
    return { verdict: "unresolved", duplicateOf: null, duplicateName: null };
  }

  return { verdict: "add", duplicateOf: null, duplicateName: null };
}
