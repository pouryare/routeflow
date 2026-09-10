import type { AppTab } from "@/lib/appNav";
import { normalisePersian } from "@/lib/persian";

/** Everything the search overlay decides, as pure functions.
 *
 *  components/meridian/SearchOverlay.tsx renders; this module decides. The split is what
 *  makes the overlay testable in a repo that does not render components in tests: the
 *  same arrangement as HoverPill's pillModel. Safe to import on the server: no DOM. */

export type SearchKind = "page" | "customer" | "order";

export type SearchHit = {
  kind: SearchKind;
  /** Stable across sessions (`customer:12`), so a recent survives a reload and dedupes. */
  id: string;
  label: string;
  sub?: string;
  /** Always an in-app path; parseRecent enforces it for anything read back from storage. */
  href: string;
};

export const RECENT_KEY = "meridian.search.recent";
export const RECENT_MAX = 6;
/** Window event the search overlay fires on /map instead of navigating to the page it is
 *  already on; CoverageMap listens and flies to the customer (detail: customer id). */
export const MAP_FOCUS_EVENT = "meridian:map-focus-customer";
/** Below this the server is not asked: one letter matches most of the customer table. */
export const MIN_REMOTE_QUERY = 2;

/** The reader's reachable pages whose label contains the query. A label that starts with
 *  it outranks one that merely contains it; ties go to the shorter label, which is the
 *  more specific page. */
export function rankPages(tabs: AppTab[], q: string, limit = 6): SearchHit[] {
  const needle = normalisePersian(q.trim());
  if (!needle) return [];
  return tabs
    .filter((t) => t.ready)
    .map((t) => ({ t, at: normalisePersian(t.label).indexOf(needle) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at || a.t.label.length - b.t.label.length)
    .slice(0, limit)
    .map(({ t }) => ({ kind: "page" as const, id: `page:${t.href}`, label: t.label, href: t.href }));
}

export function pushRecent(list: SearchHit[], hit: SearchHit): SearchHit[] {
  return [hit, ...list.filter((h) => h.id !== hit.id)].slice(0, RECENT_MAX);
}

const KINDS: readonly string[] = ["page", "customer", "order"];

/** An in-app path, and only that: `/x` yes; `//host` and `https://…` no. localStorage is
 *  writable by anything on this origin, and a stored href is navigated to on Enter. */
const isInternal = (href: string) => href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/\\");

function isHit(v: unknown): v is SearchHit {
  if (!v || typeof v !== "object") return false;
  const h = v as Record<string, unknown>;
  return (
    typeof h.kind === "string" && KINDS.includes(h.kind) &&
    typeof h.id === "string" && typeof h.label === "string" &&
    typeof h.href === "string" && isInternal(h.href) &&
    (h.sub === undefined || typeof h.sub === "string")
  );
}

/** Reads what localStorage held. Never throws: storage is written by other tabs and older
 *  builds, and a broken recents list must not take the search box down with it. */
export function parseRecent(raw: string | null): SearchHit[] {
  try {
    const v: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter(isHit).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** The keyboard cursor. -1 is "nothing highlighted", the state before the first arrow. */
export function moveActive(i: number, delta: 1 | -1, n: number): number {
  if (n === 0) return -1;
  if (i < 0) return delta > 0 ? 0 : n - 1;
  return (i + delta + n) % n;
}
