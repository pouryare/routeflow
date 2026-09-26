// How a decoded link's coordinates were obtained, and how each outcome is labelled.
//
// This map is keyed by the *whole* `LocationResolution` union rather than a
// hand-copied subset of it. The panel used to declare its own narrower local union,
// which is why a `"browser"` key could be missing while every type, lint and test
// still passed -- `resolveMapsLink` really does return `"browser"`, so a
// Playwright-resolved link threw on `meta.icon` at render time. Keying the record by
// the real union makes an omission a compile error instead of a runtime crash.
//
// Pure and network-free: labels, icons and colours only, no fetching, so it is
// importable from a client component and testable without a browser.
import type { LocationResolution } from "@/lib/db";
import type { IconName } from "@/components/meridian/Icon";

export interface ResolutionMeta {
  icon: IconName;
  label: string;
  color: string;
  /** A placement we can plant a pin from without a human looking at it. */
  exact: boolean;
}

export const RESOLUTION_META: Record<LocationResolution, ResolutionMeta> = {
  direct: { icon: "check", label: "دقیق", color: "var(--good)", exact: true },
  pluscode: { icon: "check", label: "دقیق", color: "var(--good)", exact: true },
  // A real Chromium page read Google's APP_INITIALIZATION_STATE. Exact, and slower
  // than the two above -- which is the distinction the progress UI exists to show.
  browser: { icon: "compass", label: "دقیق (مرورگر)", color: "var(--good)", exact: true },
  // Nominatim matched on an address string, so the pin is a neighbourhood at best.
  nominatim: { icon: "target", label: "تقریبی", color: "var(--accent)", exact: false },
  manual: { icon: "map-pin", label: "دستی", color: "var(--good)", exact: true },
  unresolved: { icon: "warn", label: "نیاز به مکان‌یابی دستی", color: "var(--warn)", exact: false },
};

/**
 * The cost tier a resolution belongs to, used by the runner to always spend its
 * cheap attempts first. Lower is cheaper and therefore picked earlier.
 *
 * `manual` and `unresolved` are terminal -- no further attempt will change them --
 * so they rank below every attempt that could still succeed.
 */
export const RESOLUTION_TIER: Record<LocationResolution, number> = {
  direct: 0,
  pluscode: 0,
  browser: 1,
  nominatim: 2,
  manual: 3,
  unresolved: 3,
};

/** Resolutions that may be auto-added without a human confirming the pin. */
export function isAutoAddable(resolution: LocationResolution): boolean {
  return RESOLUTION_META[resolution].exact;
}
