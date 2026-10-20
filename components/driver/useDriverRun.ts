"use client";

import { friendlyError } from "@/lib/userMessage";
import { useCallback, useMemo, useState } from "react";
import { useRunAfterMount } from "@/lib/useRunAfterMount";
import type { RunFacilityStop } from "@/lib/delivery";

/** A driver's own day, from /api/lead-runs.
 *
 *  It used to live in app/(shell)/leads/hooks/, beside useLeads, and two components/
 *  files imported it from a route directory. It is now components/driver/, because the
 *  only thing that consumes it is the driver's own screen — which lives on /driver in
 *  app/(bare) — and a bare page must not reach into the shell's internals.
 *
 *  Deliberately separate from useLeads rather than a branch inside it. useLeads is the
 *  manager's pool -- it fetches /api/locations and /api/lead-lists, both of which are
 *  owner/group_manager routes, so a driver asking for them gets two 403s and an empty
 *  page. The two share no state, which is the point: a driver has no pool.
 *
 *  What the driver sees is derived on the server (lib/repo/leadRuns.ts) from the pin
 *  itself, so "the next stop" cannot disagree with what the office sees. */

export interface DriverStop {
  location_id: number;
  sort_order: number;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  status: string | null;
  visit_outcome: string | null;
  rating_potential: number | null;
  outcome_label: string;
  next_action: string | null;
}

export interface DriverRun {
  id: number;
  run_date: string;
  status: string;
  driver_name: string | null;
  notes: string | null;
  stops: DriverStop[];
  /** The load and the unload, addresses included. Separate from `stops` on purpose: they are
   *  NOT numbered, because the unload has no position and numbering it would let a drag
   *  renumber the delivery sequence below. */
  facilities?: RunFacilityStop[];
}

/** A stop the driver still owns.
 *
 *  Visited pins drop out, and so does a stop whose outcome sends it to somebody else -- a
 *  lead handed to phone sales is no longer this driver's to visit, and showing it as pending
 *  would send them back to a door that has already been answered. */
export function pendingStops(stops: DriverStop[]): DriverStop[] {
  return stops.filter((s) => s.visit_outcome === null || s.next_action === "reminder");
}

/** The stop to walk to next: the first pending one, in the order the manager planned. */
export function nextStop(stops: DriverStop[]): DriverStop | null {
  return pendingStops(stops)[0] ?? null;
}

/* The server render is the FIRST PAINT, not a cache. It is passed in as `initialRun`
   from the /driver page so the page does not fill in twice — the delivery section above
   is already painted by the time a client fetch would resolve. The fetch still runs on
   mount, and still runs after a reorder or a recorded visit: DriverRunView must not be
   trusted to stay fresh, and it is not.

   `null` and `undefined` are deliberately different. `null` is "the server ran and there
   is no run", so there is nothing to wait for and no skeleton to show. `undefined` is
   "the server did not answer", so `loading` starts true and the skeleton is the honest
   first state. */
export function useDriverRun(initialRun?: DriverRun | null) {
  const [run, setRun] = useState<DriverRun | null>(initialRun ?? null);
  const [loading, setLoading] = useState(initialRun === undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/lead-runs");
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(friendlyError(data?.error, "مسیر امروز بارگذاری نشد؛ دوباره تلاش کنید"));
      setRun((data.run as DriverRun) ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "مسیر امروز بارگذاری نشد؛ دوباره تلاش کنید");
    } finally {
      setLoading(false);
    }
  }, []);

  useRunAfterMount(load);

  const stops = useMemo(() => run?.stops ?? [], [run]);
  const pending = useMemo(() => pendingStops(stops), [stops]);
  const next = useMemo(() => nextStop(stops), [stops]);

  /** Reorder the driver's own stops. The one thing a driver may change about a route. */
  const move = useCallback(async (locationId: number, dir: -1 | 1) => {
    setRun((prev) => {
      if (!prev) return prev;
      const ids = prev.stops.map((s) => s.location_id);
      const i = ids.indexOf(locationId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ids.length) return prev;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      void fetch(`/api/lead-runs/${prev.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location_ids: ids }),
      }).then(() => load());
      return { ...prev, stops: sortByIds(prev.stops, ids) };
    });
  }, [load]);

  return { run, stops, pending, next, loading, error, reload: load, move };
}

const sortByIds = (stops: DriverStop[], ids: number[]): DriverStop[] =>
  ids.map((id) => stops.find((s) => s.location_id === id)).filter((s): s is DriverStop => !!s);
