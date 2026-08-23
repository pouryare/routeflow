/** The two per-browser lists of customers the sidebar keeps: pinned and recently viewed.
 *
 *  Both answer the same complaint from opposite directions. The customer list is 135
 *  long and sorted by nothing the driver cares about, so the handful of shops that
 *  matter this week are found by searching for them every single time. Pinned is the
 *  deliberate answer ("these ones"), recent is the automatic one ("the ones I keep
 *  opening").
 *
 *  Kept in localStorage rather than the database on purpose: this is one person's
 *  working set on one device, not a fact about the business. When a second driver
 *  arrives, their pins should be theirs, and nothing here needs migrating for that.
 *
 *  The list operations are pure so they can be tested without a browser; the storage
 *  wrappers around them swallow every error, since a browser that refuses storage should
 *  cost the user a convenience, not the page.
 */

export const PINNED_KEY = "coverage_pinned";
export const RECENT_KEY = "coverage_recent";

/** Long enough to hold a morning's work, short enough to stay scannable inside a
 *  sidebar section. Past about eight, "recent" stops being a shortcut and becomes a
 *  second list to search. */
export const RECENT_MAX = 8;

/** Most-recent-first, no duplicates, capped. Re-viewing a customer moves it to the top
 *  rather than adding a second entry. */
export function addRecent(list: number[], id: number, max = RECENT_MAX): number[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, max);
}

/** Pin/unpin. Newly pinned goes to the top, which is where the user was looking. */
export function toggleId(list: number[], id: number): number[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [id, ...list];
}

/** Drops ids that no longer exist -- a customer deleted from the source spreadsheet
 *  would otherwise sit in the pinned list forever as an unopenable ghost. */
export function pruneIds(list: number[], existing: Set<number>): number[] {
  return list.filter((id) => existing.has(id));
}

function parseIds(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is number => Number.isInteger(x));
  } catch {
    return [];
  }
}

export function readIds(key: string): number[] {
  if (typeof window === "undefined") return [];
  try {
    return parseIds(localStorage.getItem(key));
  } catch {
    return [];
  }
}

export function writeIds(key: string, ids: number[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // Storage blocked. The list still works for this session.
  }
}
