"use client";

/** GET /api/prefs once per page load, shared by everything that reads it at start-up.
 *
 *  SoundSync and FxSync both asked for the same answer as the page opened, so every load sent
 *  the request twice (notes/db-index-audit-2026-11-09.md). Saving a preference still PATCHes
 *  the route directly. The screens that save one read their own answer back from that PATCH, and
 *  nothing else re-reads during the same page load, so the shared copy never needs replacing. */
export interface PrefsAnswer {
  status: number;
  data: Record<string, unknown> | null;
}

let pending: Promise<PrefsAnswer> | null = null;

export function prefsOnce(): Promise<PrefsAnswer> {
  pending ??= fetch("/api/prefs", { cache: "no-store" }).then(async (res) => ({
    status: res.status,
    data: (await res.json().catch(() => null)) as Record<string, unknown> | null,
  }));
  // A failed request (offline) is not kept, so the next caller tries again.
  pending.catch(() => {
    pending = null;
  });
  return pending;
}
