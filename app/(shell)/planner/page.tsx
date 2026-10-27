"use client";

import { FieldInput } from "@/components/FieldInput";
import VisitPlanEntry from "@/components/flows/VisitPlanEntry";
import { useRunAfterMount } from "@/lib/useRunAfterMount";
import { friendlyError } from "@/lib/userMessage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHydrated } from "@/lib/useHydrated";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { CustomerRow } from "@/lib/types";
import type { SavedLocationRow } from "@/lib/db";
import type { FacilityRow } from "@/lib/facilityTypes";
import { isPlaced, pickOrigin, pickPlaced } from "@/lib/facilityTypes";
import {
  distanceKm,
  distanceToSegmentKm,
  formatDistanceKm,
  nearestNeighborOrder,
  routeLengthKm,
} from "@/lib/geo";
import { reorderGain } from "@/lib/routing/reorderGain";
import { straightLine } from "@/lib/routing/distance";
import type { RouteStop } from "@/components/PlannerRouteMap";
import { useToast } from "@/components/ToastProvider";
import { faFixed, faNum } from "@/lib/format";
import { replaceUrlQuery } from "@/lib/deepLink";
import CopyButton from "@/components/CopyButton";
import { useNavApp } from "@/components/NavAppSetting";
import { navApp, navigateUrl } from "@/lib/navApps";
import PrintButton from "@/components/PrintButton";
import { Icon } from "@/components/meridian/Icon";
import PlanDayList from "@/components/planner/PlanDayList";
import PlanOriginPanel from "@/components/planner/PlanOriginPanel";

import { LeadLocation, AddCandidate, PlanRow, toDateStr, dayLabel, dateLabel, Origin, RETURN_KEY, readReturnToOrigin, addCandidatesFor, pickCandidatesFor } from "@/lib/plannerView";
import WidgetBoundary from "@/components/WidgetBoundary";

const PlannerPickMap = dynamic(() => import("@/components/PlannerPickMap"), { ssr: false });
const PlannerRouteMap = dynamic(() => import("@/components/PlannerRouteMap"), { ssr: false });

export default function PlannerPage() {
  const days = useMemo(() => {
    const arr: Date[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      arr.push(d);
    }
    return arr;
  }, []);

  const [selectedDate, setSelectedDate] = useState(() => toDateStr(days[0]));
  /* Below md the plan list and the route map are two panes behind a segmented control (one screen
     of content at a time); from md up both show, as before. */
  const [pane, setPane] = useState<"list" | "map">("list");

  // /planner?date=2026-08-24 -- "here is tomorrow's round".
  //
  // Adopted on the first render after hydration (see `restored` below) rather than as
  // the initial state, even though the value is available synchronously: this page is
  // prerendered, so the server has no query string and would render today while the
  // browser rendered the linked day. React resolves that disagreement by discarding the
  // server's HTML, which is a real cost paid for one frame's head start.
  //
  // Only a date the strip actually offers is honoured -- a date outside the week has no
  // tab to select and would strand the page on a day it cannot navigate away from.
  const hydrated = useHydrated();
  const [restored, setRestored] = useState(false);

  // Keeps the address bar on the day being looked at, so the link is copyable at any
  // moment rather than only the one the page was opened with. It waits until the link
  // has been read: the first commit would otherwise replace ?date= with today before
  // anyone looked at it.
  useEffect(() => {
    if (restored) replaceUrlQuery(`?date=${selectedDate}`);
  }, [selectedDate, restored]);
  const [plansByDate, setPlansByDate] = useState<Record<string, PlanRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [leads, setLeads] = useState<LeadLocation[]>([]);
  const [addQuery, setAddQuery] = useState("");
  const [myPos, setMyPos] = useState<{ lat: number; lng: number } | null>(null);
  const [facilities, setFacilities] = useState<FacilityRow[]>([]);
  const [originOverrideId, setOriginOverrideId] = useState<number | null>(null);
  const [originPickerOpen, setOriginPickerOpen] = useState(false);
  const [returnToOrigin, setReturnToOrigin] = useState(true);
  const [optimising, setOptimising] = useState(false);
  const [siteEvents, setSiteEvents] = useState<{ created_at: string; note: string | null; entity_id: number }[]>([]);
  const toast = useToast();
  const [navAppId] = useNavApp();
  const [locating, setLocating] = useState(false);
  const searchParams = useSearchParams();
  const hasAutoAddedLead = useRef(false);


  const loadWeek = useCallback(async () => {
    setLoading(true);
    const from = toDateStr(days[0]);
    const to = toDateStr(days[days.length - 1]);
    const res = await fetch(`/api/visit-plans?from=${from}&to=${to}`);
    const data = await res.json();
    const grouped: Record<string, PlanRow[]> = {};
    for (const p of (data.plans ?? []) as PlanRow[]) {
      (grouped[p.planned_date] ??= []).push(p);
    }
    setPlansByDate(grouped);
    setLoading(false);
  }, [days]);

  useRunAfterMount(loadWeek);

  // Declared after loadWeek, deliberately: the effect calls it, so listing it as a
  // dependency -- rather than suppressing the rule -- means this block has to sit below it.

  // Auto-add lead from URL param ?lead=123
  //
  // The dependencies are listed rather than suppressed. `hasAutoAddedLead` is what makes
  // this once-only, not the empty array: a re-run with a changed `searchParams` or
  // `selectedDate` is short-circuited by the ref on the first line. An empty dep list with
  // an eslint-disable said "run once" while capturing whatever the values happened to be on
  // the first render, which is a different claim and a worse one.
  useEffect(() => {
    const leadId = searchParams.get("lead");
    if (leadId && !hasAutoAddedLead.current) {
      hasAutoAddedLead.current = true;
      const id = Number(leadId);
      if (!Number.isNaN(id)) {
        (async () => {
          try {
            const res = await fetch("/api/visit-plans", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ entity_type: "lead_location", entity_id: id, planned_date: selectedDate }),
            });
            if (res.ok) {
              toast("مکان به برنامه اضافه شد.", "success");
              loadWeek();
            }
          } catch { /* ignore */ }
        })();
      }
    }
  }, [searchParams, selectedDate, toast, loadWeek]);

  useEffect(() => {
    fetch("/api/customers")
      .then((r) => r.json())
      .then((d) => setCustomers(d.customers ?? []));
  }, []);

  // Lead locations for the "add lead to plan" feature
  useEffect(() => {
    fetch("/api/locations")
      .then((r) => r.json())
      .then((d) => setLeads((d.locations ?? []).map((l: SavedLocationRow) => ({
        id: l.id,
        name: l.name,
        lat: l.lat,
        lng: l.lng,
        address: l.address,
      }))))
      .catch(() => {});
  }, []);

  // What the browser alone knows -- the link's ?date= and the saved return-to-origin
  // toggle -- adopted once, on the first render after hydration.
  if (hydrated && !restored) {
    setRestored(true);
    const wanted = new URLSearchParams(window.location.search).get("date");
    if (wanted && days.map(toDateStr).includes(wanted)) setSelectedDate(wanted);
    setReturnToOrigin(readReturnToOrigin());
  }

  useEffect(() => {
    fetch("/api/facilities")
      .then((r) => r.json())
      .then((d) => setFacilities(d.facilities ?? []))
      .catch(() => {});
  }, []);

  // Feature 12: the day's depot arrivals, logged by the geofence. Only fetched for the
  // selected day, and only used to describe a day that has actually started -- nothing
  // here fabricates a start time from the plan.
  useEffect(() => {
    fetch(`/api/activity?entity_type=facility&date=${selectedDate}`)
      .then((r) => r.json())
      .then((d) => setSiteEvents(d.activity ?? []))
      .catch(() => setSiteEvents([]));
  }, [selectedDate]);

  const dayPlans = (plansByDate[selectedDate] ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);

  const addCandidates: AddCandidate[] = useMemo(
    () => addCandidatesFor(addQuery, customers, leads, dayPlans),
    [addQuery, customers, leads, dayPlans]
  );

  const pickCandidates = useMemo(() => pickCandidatesFor(customers, leads, dayPlans), [customers, leads, dayPlans]);

  async function addPicked(keys: string[]) {
    for (const k of keys) {
      await fetch("/api/visit-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity_type: k.startsWith("l") ? "lead_location" : "customer", entity_id: Number(k.slice(1)), planned_date: selectedDate }),
      });
    }
    await loadWeek();
  }

  async function addToPlan(customerId: number) {
    try {
      const res = await fetch("/api/visit-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity_type: "customer", entity_id: customerId, planned_date: selectedDate }),
      });
      if (!res.ok) throw new Error();
      toast("به برنامه اضافه شد.", "success");
    } catch {
      toast("به برنامه اضافه نشد؛ دوباره تلاش کنید", "error");
    } finally {
      setAddQuery("");
      loadWeek();
    }
  }

  async function addLeadToPlan(leadId: number) {
    try {
      const res = await fetch("/api/visit-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity_type: "lead_location", entity_id: leadId, planned_date: selectedDate }),
      });
      if (!res.ok) throw new Error();
      toast("مکان پیشنهادی به برنامه اضافه شد.", "success");
    } catch {
      toast("مکان به برنامه اضافه نشد؛ دوباره تلاش کنید", "error");
    } finally {
      setAddQuery("");
      loadWeek();
    }
  }

  const STATUS_TOAST: Record<PlanRow["status"], string> = { planned: "برنامه‌ریزی‌شده", done: "انجام‌شده", skipped: "رد شده" };

  async function setStatus(id: number, status: PlanRow["status"]) {
    try {
      const res = await fetch(`/api/visit-plans/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      toast(`وضعیت به «${STATUS_TOAST[status]}» تغییر کرد.`, "success");
    } catch {
      toast("وضعیت توقف تغییر نکرد؛ دوباره تلاش کنید", "error");
    } finally {
      loadWeek();
    }
  }

  /** Re-adds a removed stop where it was, not at the end. DELETE leaves the surrounding
   *  sort_order values untouched, so the row's original value still fits the gap it left
   *  -- and its original status comes back with it, since undoing the removal of a stop
   *  already marked done must not silently reset it to planned. */
  async function restorePlan(p: PlanRow) {
    try {
      const res = await fetch("/api/visit-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_type: p.entity_type,
          entity_id: p.entity_id,
          planned_date: p.planned_date,
          sort_order: p.sort_order,
          status: p.status,
        }),
      });
      if (!res.ok) throw new Error();
      toast(`«${p.label}» به برنامه بازگشت.`, "success");
    } catch {
      toast("توقف به برنامه برنگشت؛ دوباره تلاش کنید", "error");
    } finally {
      loadWeek();
    }
  }

  async function removePlan(id: number) {
    // Captured before the request: after it succeeds there is no row left to describe,
    // and the undo needs the whole thing to put it back where it was.
    const removed = dayPlans.find((p) => p.id === id) ?? null;
    try {
      const res = await fetch(`/api/visit-plans/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast(
        removed ? `«${removed.label}» از برنامه حذف شد.` : "از برنامه حذف شد.",
        "info",
        removed ? { label: "بازگردانی حذف", onClick: () => restorePlan(removed) } : undefined
      );
    } catch {
      toast("توقف از برنامه حذف نشد؛ دوباره تلاش کنید", "error");
    } finally {
      loadWeek();
    }
  }

  async function move(id: number, dir: -1 | 1) {
    const idx = dayPlans.findIndex((p) => p.id === id);
    const swapWith = dayPlans[idx + dir];
    if (!swapWith) return;
    await Promise.all([
      fetch(`/api/visit-plans/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sort_order: swapWith.sort_order }),
      }),
      fetch(`/api/visit-plans/${swapWith.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sort_order: dayPlans[idx].sort_order }),
      }),
    ]);
    loadWeek();
  }

  function locate() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMyPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  const origin = useMemo<Origin | null>(() => {
    const override = originOverrideId === null ? null : facilities.find((f) => f.id === originOverrideId);
    // An unplaced facility cannot be an origin -- there is no point to measure from. It
    // stays in the list to be positioned; it just does not become the day's starting point.
    if (override && isPlaced(override))
      return { lat: override.lat, lng: override.lng, label: override.name, source: "override" };
    if (myPos) return { lat: myPos.lat, lng: myPos.lng, label: "موقعیت من", source: "gps" };
    const def = pickOrigin(facilities);
    if (def) return { lat: def.lat, lng: def.lng, label: def.name, source: "facility" };
    return null;
  }, [originOverrideId, facilities, myPos]);

  const plannedStops = useMemo(
    () =>
      dayPlans.filter(
        (p) => p.status === "planned" && p.entity_type !== "district" && p.lat && p.lng
      ) as (PlanRow & { lat: number; lng: number })[],
    [dayPlans]
  );

  // The list's own order is the source of truth -- the user can reorder it by hand, and
  // silently re-sorting underneath them would throw that away. Nearest-neighbour only
  // fills in when no origin exists at all, which is the pre-facilities behaviour.
  const orderedStops = useMemo(() => {
    if (plannedStops.length === 0) return [];
    if (!origin) return nearestNeighborOrder(plannedStops, null);
    return plannedStops;
  }, [plannedStops, origin]);

  /** Distance from the previous positioned stop to each one, keyed by plan id.
   *
   *  Totals tell you a day is long. They do not tell you *which* pair of stops made it
   *  long, which is the only thing you can act on -- and it is exactly what a bad
   *  ordering looks like: one leg several times the size of its neighbours.
   *
   *  Walks the list in displayed order, carrying the last known position forward, so a
   *  district row (which has no coordinates) is skipped rather than breaking the chain
   *  between the stops on either side of it. */
  const legKm = useMemo(() => {
    const legs = new Map<number, number>();
    let prev: { lat: number; lng: number } | null = origin;
    for (const p of dayPlans) {
      if (p.lat === null || p.lng === null) continue;
      const here = { lat: p.lat, lng: p.lng };
      if (prev) legs.set(p.id, distanceKm(prev, here));
      prev = here;
    }
    return legs;
  }, [dayPlans, origin]);

  /** The drive home, when there is one. Not part of legKm because it belongs to no stop. */
  const returnLegKm = useMemo(() => {
    if (!returnToOrigin || !origin) return null;
    const last = [...dayPlans].reverse().find((p) => p.lat !== null && p.lng !== null);
    if (!last) return null;
    return distanceKm({ lat: last.lat as number, lng: last.lng as number }, origin);
  }, [dayPlans, origin, returnToOrigin]);

  const dayLengthKm = useMemo(
    () => (origin && orderedStops.length ? routeLengthKm(origin, orderedStops, returnToOrigin) : null),
    [origin, orderedStops, returnToOrigin]
  );

  // Feature 4: is it worth driving to the warehouse to load before starting? Runs the
  // same day twice -- straight from the origin, and via the warehouse -- and states the
  // difference. Both legs are straight-line, so the systematic understatement cancels
  // and the delta is the honest part.
  const warehouseDetour = useMemo(() => {
    if (!origin || orderedStops.length === 0) return null;
    // pickPlaced, not a combined predicate: an unplaced warehouse has no position to route
    // from, and only a bare isPlaced filter narrows the element type.
    const warehouse = pickPlaced(facilities, (f) => f.kind === "warehouse");
    if (!warehouse) return null;
    // Already starting there -- there is no detour to weigh up.
    if (distanceKm(origin, warehouse) < 0.05) return null;
    // Already a stop on the day: the decision has been made, and re-offering it as
    // "+0 metres" is noise, not advice.
    if (orderedStops.some((s) => s.entity_type === "facility" && s.entity_id === warehouse.id)) return null;

    const direct = routeLengthKm(origin, orderedStops, returnToOrigin);
    const viaWarehouse = routeLengthKm(origin, [warehouse, ...orderedStops], returnToOrigin);
    return { name: warehouse.name, deltaKm: viaWarehouse - direct };
  }, [origin, orderedStops, facilities, returnToOrigin]);

  // Feature 6: what a 2-opt pass would save, computed for the button's label. Applying
  // it is an explicit action -- see applyOptimalOrder.
  const optimisation = useMemo(() => {
    if (!origin || orderedStops.length < 3) return null;
    return reorderGain(origin, orderedStops, returnToOrigin, straightLine);
  }, [origin, orderedStops, returnToOrigin]);

  // Google's directions share-link accepts at most this many intermediate waypoints and
  // silently drops the rest -- which, in a van, means stops that vanish without a word.
  // Surfaced as a warning rather than absorbed.
  const GOOGLE_WAYPOINT_LIMIT = 10;

  const googleRoute = useMemo(() => {
    if (orderedStops.length === 0 || !origin) return null;

    // Returning home makes the origin the destination and the last customer just
    // another waypoint; otherwise the last customer is where the route ends.
    const destination = returnToOrigin ? origin : orderedStops[orderedStops.length - 1];
    const waypointStops = returnToOrigin ? orderedStops : orderedStops.slice(0, -1);

    const params = new URLSearchParams({
      api: "1",
      origin: `${origin.lat},${origin.lng}`,
      destination: `${destination.lat},${destination.lng}`,
      travelmode: "driving",
    });
    const included = waypointStops.slice(0, GOOGLE_WAYPOINT_LIMIT);
    if (included.length) {
      params.set("waypoints", included.map((s) => `${s.lat},${s.lng}`).join("|"));
    }
    // Only Google's URL API can carry a whole day. For any other navigation app the
    // honest reduction is the first leg -- the alternative is a link that looks like it
    // holds the round and silently holds one stop of it.
    if (navAppId !== "google") {
      return {
        url: navigateUrl(navAppId, orderedStops[0], orderedStops[0].label),
        dropped: 0,
        singleLeg: orderedStops.length > 1,
      };
    }

    return {
      url: `https://www.google.com/maps/dir/?${params.toString()}`,
      dropped: waypointStops.length - included.length,
      singleLeg: false,
    };
  }, [orderedStops, origin, returnToOrigin, navAppId]);

  // Feature 5. The same segment-distance helper the corridor uses, asked per consecutive
  // leg instead of once end to end: if the day already drives past the warehouse, say so
  // where the decision is rather than in a summary the user has to translate back into
  // "between which two stops?".
  //
  // The threshold is fixed rather than configurable: there is no evidence yet about the
  // right number, and a setting would invite tuning a value nobody can justify.
  const RESTOCK_NEAR_KM = 3;

  const restockHint = useMemo(() => {
    if (!origin || orderedStops.length === 0) return null;
    const warehouse = pickPlaced(facilities, (f) => f.kind === "warehouse");
    if (!warehouse) return null;
    // Already on the route -- nothing to suggest.
    if (orderedStops.some((s) => s.entity_type === "facility" && s.entity_id === warehouse.id)) return null;

    const legs = [origin, ...orderedStops];
    let best: { afterIndex: number; km: number } | null = null;
    for (let i = 0; i < legs.length - 1; i++) {
      const km = distanceToSegmentKm(warehouse, legs[i], legs[i + 1]);
      if (km <= RESTOCK_NEAR_KM && (!best || km < best.km)) best = { afterIndex: i, km };
    }
    return best ? { warehouse, ...best } : null;
  }, [origin, orderedStops, facilities]);

  /** Inserts the warehouse into the day at the leg it sits nearest to, then rewrites
   *  every stop's sort_order so it actually lands there rather than at the end. Reuses
   *  the same PATCH the auto-order button uses. */
  async function insertRestockStop() {
    if (!restockHint) return;
    setOptimising(true);
    try {
      const res = await fetch("/api/visit-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_type: "facility",
          entity_id: restockHint.warehouse.id,
          planned_date: selectedDate,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(friendlyError(data.error, "توقف به برنامه اضافه نشد؛ دوباره تلاش کنید"));

      // afterIndex counts the origin as position 0, so it is already the index the new
      // stop should occupy among the stops themselves.
      const ids = orderedStops.map((s) => s.id);
      ids.splice(restockHint.afterIndex, 0, data.id);
      await Promise.all(
        ids.map((id, index) =>
          fetch(`/api/visit-plans/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sort_order: index }),
          })
        )
      );
      toast(`${restockHint.warehouse.name} به مسیر اضافه شد`, "success");
      await loadWeek();
    } catch (e) {
      toast(e instanceof Error ? e.message : "خطا در افزودن توقف", "error");
    } finally {
      setOptimising(false);
    }
  }

  /** Feature 12. Derived entirely from logged arrivals, so a day with the site geofence
   *  switched off simply shows nothing rather than an invented figure. Distance covered
   *  counts only the stops actually marked done -- what was planned is not what was
   *  driven. */
  /* "Now", as state rather than a Date.now() call inside the memo below.
   *
   * Calling it during render is impure -- react-hooks/purity -- and it was also quietly
   * wrong: inside a useMemo it only re-read when one of the memo's other dependencies
   * changed, so an open day's elapsed time sat frozen at whatever it was when the memo
   * last ran. Ticking it makes the figure do what the comment beside it already claims.
   *
   * The interval is only armed while a day really is open, so no other page state or
   * date change causes a timer to run. */
  const [now, setNow] = useState(() => Date.now());
  const dayOpen = siteEvents.length === 1 && selectedDate === toDateStr(new Date(now));
  useEffect(() => {
    if (!dayOpen) return;
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [dayOpen]);

  const dayLog = useMemo(() => {
    if (siteEvents.length === 0) return null;
    const times = siteEvents.map((e) => new Date(e.created_at).getTime()).filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
    if (times.length === 0) return null;

    const first = times[0];
    const last = times[times.length - 1];
    const done = dayPlans.filter((p) => p.status === "done");

    // A single arrival means the day is still open: measure to now, not to that one
    // event, which would read as a zero-length day.
    const isToday = selectedDate === toDateStr(new Date(now));
    const end = times.length > 1 ? last : isToday ? now : last;
    const minutes = Math.max(0, Math.round((end - first) / 60000));

    const drivenKm =
      origin && done.length > 0
        ? routeLengthKm(
            origin,
            done.filter((p) => p.lat && p.lng) as (PlanRow & { lat: number; lng: number })[],
            returnToOrigin
          )
        : null;

    return {
      startedAt: new Date(first),
      minutes,
      stillOpen: times.length === 1 && isToday,
      doneCount: done.length,
      drivenKm,
      stopCount: siteEvents.length,
    };
  }, [siteEvents, dayPlans, origin, returnToOrigin, selectedDate, now]);

  const routeStops = useMemo<RouteStop[]>(() => {
    if (orderedStops.length === 0) return [];
    const stops: RouteStop[] = [];
    if (origin) stops.push({ lat: origin.lat, lng: origin.lng, label: origin.label });
    orderedStops.forEach((s) => stops.push({ lat: s.lat, lng: s.lng, label: s.label }));
    if (origin && returnToOrigin) stops.push({ lat: origin.lat, lng: origin.lng, label: `${origin.label} (بازگشت)` });
    return stops;
  }, [orderedStops, origin, returnToOrigin]);

  /** Feature 6. Deliberately an explicit action, not a live re-sort: the stop list has
   *  manual up/down arrows, and silently reordering underneath the user would discard
   *  the arrangement they just made by hand. */
  async function applyOptimalOrder() {
    if (!optimisation) return;
    setOptimising(true);
    try {
      await Promise.all(
        optimisation.improved.map((stop, index) =>
          fetch(`/api/visit-plans/${stop.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sort_order: index }),
          })
        )
      );
      toast(`ترتیب بهینه اعمال شد — ${faFixed(optimisation.savedPct, 0)}٪ کوتاه‌تر`, "success");
      await loadWeek();
    } catch {
      toast("ترتیب بهینه اعمال نشد؛ دوباره تلاش کنید", "error");
    } finally {
      setOptimising(false);
    }
  }

  function toggleReturnToOrigin() {
    setReturnToOrigin((v) => {
      const next = !v;
      localStorage.setItem(RETURN_KEY, next ? "1" : "0");
      return next;
    });
  }

  return (
    <>
    <div dir="rtl" className="print-report pagewrap">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-mono text-[length:var(--text-xs)] uppercase tracking-[0.12em] text-accent">
              Route Planner
            </div>
            <h1 className="text-[length:var(--text-xl)] font-bold text-text">برنامه‌ریزی مسیر و پوشش</h1>
          </div>
          <Link
            href="/map"
            className="no-print rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-[length:var(--text-sm)] text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent hover:text-accent"
          >
            بازگشت به نقشه ←
          </Link>
        </div>

        <div className="no-print flex gap-1 overflow-x-auto rounded-[var(--radius-md)] border border-border bg-surface p-1">
          {days.map((d) => {
            const ds = toDateStr(d);
            const active = ds === selectedDate;
            const count = (plansByDate[ds] ?? []).length;
            return (
              <button
                key={ds}
                onClick={() => setSelectedDate(ds)}
                className={`flex shrink-0 flex-col items-center gap-0.5 rounded-[var(--radius-sm)] px-3 py-2 text-[length:var(--text-sm)] transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] ${
                  active ? "bg-accent font-medium text-accent-ink" : "text-text-muted hover:bg-white/5 hover:text-text"
                }`}
              >
                <Icon name="calendar" size="sm" />
                <span>{dayLabel(d)}</span>
                <span className="font-mono text-[length:var(--text-xs)] opacity-80">{dateLabel(d)}</span>
                {count > 0 && (
                  <span
                    className={`mt-0.5 rounded-full px-1.5 text-[length:var(--text-xs)] font-mono ${
                      active ? "bg-accent-ink/20 text-accent-ink" : "bg-white/10 text-text-faint"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="no-print flex gap-1 rounded-[var(--radius-md)] border border-border bg-surface p-1 md:hidden" role="group" aria-label="نمایش برنامه">
          {([["list", "فهرست برنامه", "calendar"], ["map", "نقشه مسیر", "map-pin"]] as const).map(([id, label, icon]) => (
            <button
              key={id}
              type="button"
              aria-pressed={pane === id}
              onClick={() => setPane(id)}
              className={`inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-[var(--radius-sm)] text-[length:var(--text-sm)] ${pane === id ? "bg-accent font-medium text-accent-ink" : "text-text-muted"}`}
            >
              <Icon name={icon} size="md" />
              {label}
            </button>
          ))}
        </div>

        <div className={pane === "map" ? "hidden md:contents" : "contents"}>
        <section className="no-print rounded-[var(--radius-lg)] border border-border bg-surface-raised p-4">
          <h2 className="sechead__title mb-2">
            افزودن به برنامه
          </h2>
          {/* On a phone: two taps, no keyboard. The search box stays from md up. */}
          <VisitPlanEntry customers={customers} leads={leads} selectedDate={selectedDate} onAdded={loadWeek} />
          <div className="relative hidden md:block">
            <FieldInput
              value={addQuery}
              onChange={(e) => setAddQuery(e.target.value)}
              placeholder="نام مشتری یا سرنخ…" aria-label="نام مشتری یا سرنخ"
              className="w-full text-[length:var(--text-sm)] text-text"
            />
            {addCandidates.length > 0 && (
              <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface-raised elevate-accent">
                {addCandidates.map((c) => (
                  <button
                    key={c.kind === "lead" ? `lead-${c.lead.id}` : `customer-${c.customer.id}`}
                    onClick={() => {
                      if (c.kind === "lead") addLeadToPlan(c.lead.id);
                      else addToPlan(c.customer.id);
                    }}
                    className="flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2 text-right text-[length:var(--text-sm)] text-text last:border-b-0 hover:bg-white/5"
                  >
                    <span className="truncate flex items-center gap-2">
                      {c.kind === "lead" ? (
                        <Icon name="map-pin" size="sm" className="text-accent" />
                      ) : null}
                      {c.kind === "lead" ? c.lead.name : c.customer.business_name}
                    </span>
                    <span className="shrink-0 font-mono text-[length:var(--text-xs)] text-text-faint">
                      {c.kind === "lead" ? "سرنخ" : c.customer.customer_code}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-[var(--radius-lg)] border border-border bg-surface-raised p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="sechead__title">
              برنامه {dayLabel(new Date(selectedDate))} ({faNum(dayPlans.length)})
            </h2>
            <div className="no-print flex items-center gap-2">
              <PrintButton />
              <CopyButton
                value={() => `${window.location.origin}/planner?date=${selectedDate}`}
                what="کپی لینک این روز"
              />
              <button
                onClick={locate}
                disabled={locating}
                className="inline-flex items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent hover:text-accent disabled:opacity-50"
              >
                {locating ? (
                  "در حال یافتن…"
                ) : myPos ? (
                  <>
                    موقعیت من <Icon name="check" size="sm" />
                  </>
                ) : (
                  "موقعیت من"
                )}
              </button>
              {googleRoute && (
                <a
                  href={googleRoute.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-[var(--radius-sm)] border border-accent bg-accent px-2 py-1 text-[length:var(--text-xs)] font-medium text-accent-ink transition-[filter,transform] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:scale-[1.03] hover:brightness-110 active:scale-[0.98]"
                >
                  {googleRoute.singleLeg ? `مسیریابی به توقف ۱ در ${navApp(navAppId).label}` : "شروع مسیر بهینه"}
                </a>
              )}
            </div>
          </div>

          {dayLog && (
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 font-mono text-[length:var(--text-xs)] text-text-muted">
              <span className="uppercase tracking-wide text-accent">امروز</span>
              <span>
                شروع{" "}
                <span dir="ltr" className="inline-block text-text">
                  {String(dayLog.startedAt.getHours()).padStart(2, "0")}:
                  {String(dayLog.startedAt.getMinutes()).padStart(2, "0")}
                </span>
              </span>
              <span>
                {Math.floor(dayLog.minutes / 60)} ساعت و {dayLog.minutes % 60} دقیقه
                {dayLog.stillOpen && " (در جریان)"}
              </span>
              <span>{faNum(dayLog.doneCount)} توقف انجام‌شده</span>
              {dayLog.drivenKm !== null && <span>{formatDistanceKm(dayLog.drivenKm)} — خط مستقیم</span>}
            </div>
          )}

          {/* Feature 1: the origin is always applied, but it must be visible and
              overridable -- a number computed from a point the user cannot see is a
              number they cannot check. */}
          {dayPlans.length > 0 && <PlanOriginPanel origin={origin} originPickerOpen={originPickerOpen} setOriginPickerOpen={setOriginPickerOpen} returnToOrigin={returnToOrigin} toggleReturnToOrigin={toggleReturnToOrigin} facilities={facilities} originOverrideId={originOverrideId} setOriginOverrideId={setOriginOverrideId} setMyPos={setMyPos} locate={locate} dayLengthKm={dayLengthKm} warehouseDetour={warehouseDetour} googleRoute={googleRoute} navAppId={navAppId} optimisation={optimisation} applyOptimalOrder={applyOptimalOrder} optimising={optimising} />}

          <PlanDayList loading={loading} dayPlans={dayPlans} legKm={legKm} restockHint={restockHint} optimising={optimising} insertRestockStop={insertRestockStop} move={move} setStatus={setStatus} removePlan={removePlan} navAppId={navAppId} returnLegKm={returnLegKm} origin={origin} />
        </section>
        </div>

        {/* Keyed by the pane: a map first mounted inside a hidden pane has no size, so switching
            to it remounts the map in a visible container instead of leaving a grey box. */}
        <div className={`no-print ${pane === "list" ? "hidden md:block" : ""}`}>
          <WidgetBoundary label="نقشهٔ مسیر"><PlannerRouteMap key={pane} stops={routeStops} facilities={facilities} /></WidgetBoundary>
          {/* Choosing visits on the map: one pin each, or the nearest N to where the day starts. */}
          <div className="mt-4">
            <h2 className="sechead__title mb-2">انتخاب مکان‌ها از روی نقشه</h2>
            <WidgetBoundary label="نقشهٔ انتخاب مکان‌ها"><PlannerPickMap key={`pick-${pane}-${selectedDate}`} candidates={pickCandidates} origin={origin} dayLabel={dayLabel(new Date(selectedDate))} onAdd={addPicked} /></WidgetBoundary>
          </div>
        </div>
      </div>
    </div>    </>
  );
}
