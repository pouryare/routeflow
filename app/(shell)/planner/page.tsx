"use client";

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
import { SkeletonLabel, SkeletonRows } from "@/components/Skeleton";
import EmptyState from "@/components/EmptyState";
import { Icon } from "@/components/meridian/Icon";

const PlannerRouteMap = dynamic(() => import("@/components/PlannerRouteMap"), { ssr: false });

const WEEKDAYS = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];

/** A saved lead as the "add to plan" search needs it. Coordinates stay nullable: a pasted
 *  link that never resolved is still a lead worth planning a visit to. */
type LeadLocation = Pick<SavedLocationRow, "id" | "name" | "lat" | "lng" | "address">;

/** What the "add to plan" dropdown offers. Tagged rather than sniffed: a customer row has an
 *  `address` too, so testing for one cannot tell the two apart -- and did not, which listed
 *  every customer as a lead and added it to the plan as one. */
type AddCandidate =
  | { kind: "customer"; customer: CustomerRow }
  | { kind: "lead"; lead: LeadLocation };

interface PlanRow {
  id: number;
  entity_type: "district" | "customer" | "facility" | "lead_location";
  entity_id: number;
  planned_date: string;
  status: "planned" | "done" | "skipped";
  sort_order: number;
  label: string;
  lat: number | null;
  lng: number | null;
}

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dayLabel(d: Date) {
  return `${WEEKDAYS[d.getDay()]}`;
}
function dateLabel(d: Date) {
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

// Where the day's distances are measured from. Until this existed the planner fell
// back to *the first stop in the list* whenever there was no GPS fix -- which is the
// normal case, since a day is planned the evening before, indoors. Every distance
// figure and the whole stop order were computed from an arbitrary point.
//
// Precedence, highest first: a per-day override the user picked, a live GPS fix, the
// site flagged as default origin, and only then the old first-stop behaviour (kept so
// a database with no sites at all still renders).
type OriginSource = "override" | "gps" | "facility" | "first_stop";

interface Origin {
  lat: number;
  lng: number;
  label: string;
  source: OriginSource;
}

// Persisted like coverage_precision and coverage_geofence_on. Not every day ends back
// at the depot, so this is a toggle rather than always-on -- but most do, hence the
// default.
const RETURN_KEY = "coverage_return_to_origin";

function readReturnToOrigin(): boolean {
  try {
    return localStorage.getItem(RETURN_KEY) !== "0";
  } catch {
    return true;
  }
}

const STATUS_META: Record<PlanRow["status"], { label: string; color: string }> = {
  planned: { label: "برنامه‌ریزی‌شده", color: "var(--warn)" },
  done: { label: "انجام شد", color: "var(--good)" },
  skipped: { label: "رد شد", color: "var(--neutral)" },
};

function RestockHint({
  hint,
  busy,
  onAdd,
}: {
  hint: { warehouse: { name: string }; km: number };
  busy: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-dashed border-border-strong px-3 py-2">
      <span className="text-[length:var(--text-xs)] text-text-muted">
        {hint.warehouse.name} {formatDistanceKm(hint.km)} از این مسیر فاصله دارد — خط مستقیم
      </span>
      <button
        onClick={onAdd}
        disabled={busy}
        className="inline-flex items-center justify-center gap-[var(--space-2)] mr-auto rounded-[var(--radius-sm)] border border-accent px-2 py-1 text-[length:var(--text-xs)] text-accent transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-accent hover:text-accent-ink disabled:opacity-50"
      >
        <Icon name="plus" size="sm" />
        {busy ? "در حال افزودن…" : "افزودن توقف"}
      </button>
    </div>
  );
}

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

  const addCandidates: AddCandidate[] = useMemo(() => {
    const q = addQuery.trim();
    if (!q) return [];
    // Keyed by type as well as id: customer 5 and lead 5 are different rows.
    const already = new Set(dayPlans.map((p) => `${p.entity_type}:${p.entity_id}`));
    const customerMatches = customers
      .filter((c) => !already.has(`customer:${c.id}`) && (c.business_name.includes(q) || c.customer_code.includes(q)))
      .slice(0, 6)
      .map((customer): AddCandidate => ({ kind: "customer", customer }));
    const leadMatches = leads
      .filter((l) => !already.has(`lead_location:${l.id}`) && l.name.includes(q))
      .slice(0, 6)
      .map((lead): AddCandidate => ({ kind: "lead", lead }));
    return [...customerMatches, ...leadMatches];
  }, [addQuery, customers, leads, dayPlans]);

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

        <section className="no-print rounded-[var(--radius-lg)] border border-border bg-surface-raised p-4">
          <h2 className="sechead__title mb-2">
            افزودن به برنامه
          </h2>
          {/* On a phone: two taps, no keyboard. The search box stays from md up. */}
          <VisitPlanEntry customers={customers} leads={leads} selectedDate={selectedDate} onAdded={loadWeek} />
          <div className="relative hidden md:block">
            <input
              value={addQuery}
              onChange={(e) => setAddQuery(e.target.value)}
              placeholder="نام مشتری یا سرنخ…" aria-label="نام مشتری یا سرنخ"
              className="w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-[length:var(--text-sm)] text-text outline-none transition-[border-color] duration-[var(--dur-base)] ease-[var(--ease-out)] placeholder:text-text-faint focus:border-accent"
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
          {dayPlans.length > 0 && (
            <div className="mb-3 flex flex-col gap-2 rounded-[var(--radius-md)] border border-border bg-surface p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-faint">
                  مبدأ
                </span>
                <button
                  onClick={() => setOriginPickerOpen((v) => !v)}
                  className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent hover:text-accent"
                >
                  {origin ? origin.label : "تعیین نشده"}
                  {origin?.source === "gps" && " (GPS)"}
                  {origin?.source === "override" && " (برای امروز)"}
                  <span className="no-print"> <Icon name="chevron-down" size="sm" /></span>
                </button>

                <label className="mr-auto flex cursor-pointer items-center gap-1.5 text-[length:var(--text-xs)] text-text-muted">
                  <input
                    type="checkbox"
                    checked={returnToOrigin}
                    onChange={toggleReturnToOrigin}
                    className="no-print accent-[color:var(--accent)]"
                  />
                  بازگشت به مبدأ
                </label>
              </div>

              {originPickerOpen && (
                <div className="flex flex-wrap gap-1.5 border-t border-border pt-2">
                  {facilities.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => {
                        setOriginOverrideId(f.id);
                        setMyPos(null);
                        setOriginPickerOpen(false);
                      }}
                      className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted hover:border-accent hover:text-accent"
                    >
                      <Icon name="locate" size="sm" />
                      {f.name}
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      setOriginOverrideId(null);
                      setOriginPickerOpen(false);
                      locate();
                    }}
                    className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted hover:border-accent hover:text-accent"
                  >
                    <Icon name="locate" size="sm" />
                    موقعیت فعلی من (GPS)
                  </button>
                  {originOverrideId !== null && (
                    <button
                      onClick={() => {
                        setOriginOverrideId(null);
                        setOriginPickerOpen(false);
                      }}
                      className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-faint hover:border-crit hover:text-crit"
                    >
                      <Icon name="external-link" size="sm" />
                      بازگشت به مبدأ پیش‌فرض
                    </button>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[length:var(--text-xs)] text-text-faint">
                {dayLengthKm !== null && (
                  <span>
                    {formatDistanceKm(dayLengthKm)} کل مسیر — خط مستقیم
                  </span>
                )}
                {/* Feature 4 */}
                {warehouseDetour && (
                  <span style={{ color: warehouseDetour.deltaKm > 0 ? "var(--warn)" : "var(--good)" }}>
                    بارگیری از {warehouseDetour.name}:{" "}
                    {warehouseDetour.deltaKm > 0 ? "+" : "−"}
                    {formatDistanceKm(Math.abs(warehouseDetour.deltaKm))}
                    {warehouseDetour.deltaKm <= 0 && " (سر راه است)"}
                  </span>
                )}
              </div>

              {googleRoute?.singleLeg && (
                <p className="text-[length:var(--text-xs)] leading-5 text-warn">
                  {navApp(navAppId).label} فقط یک مقصد را می‌پذیرد؛ توقف‌های بعدی را از همین فهرست باز کنید.
                  برای باز کردن کل مسیر در یک لینک، از گوگل‌مپ، نشان، بلد یا ویز استفاده کنید.
                </p>
              )}

              {googleRoute && googleRoute.dropped > 0 && (
                <p className="text-[length:var(--text-xs)] leading-5 text-warn">
                  گوگل‌مپ حداکثر ۱۰ ایستگاه میانی می‌پذیرد؛ {googleRoute.dropped} ایستگاه در لینک مسیر
                  نمی‌آید. مسیر را در دو بخش باز کنید.
                </p>
              )}

              {/* Feature 6: an explicit action, never a live re-sort -- the list below
                  has manual reorder arrows and they must not be overwritten silently. */}
              {optimisation && optimisation.savedPct >= 1 && (
                <button
                  onClick={applyOptimalOrder}
                  disabled={optimising}
                  className="inline-flex items-center justify-center gap-[var(--space-2)] w-fit rounded-[var(--radius-sm)] border border-accent px-2 py-1 text-[length:var(--text-xs)] text-accent transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-accent hover:text-accent-ink disabled:opacity-50"
                >
                  <Icon name="undo" size="sm" />
                  {optimising
                    ? "در حال اعمال…"
                    : `مرتب‌سازی خودکار — ${faFixed(optimisation.savedPct, 0)}٪ کوتاه‌تر (${formatDistanceKm(optimisation.savedKm)})`}
                </button>
              )}
            </div>
          )}

          {loading ? (
            <>
              <SkeletonRows rows={3} />
              <SkeletonLabel>در حال بارگذاری برنامه…</SkeletonLabel>
            </>
          ) : dayPlans.length === 0 ? (
            <EmptyState
              icon="calendar"
              title="برای این روز هنوز چیزی برنامه‌ریزی نشده"
              hint="از کادر «افزودن به برنامه» بالای همین صفحه، یک مشتری یا سرنخ پیشنهادی اضافه کنید."
            />
          ) : (
            <>
            {legKm.size > 0 && (
              <p className="mb-2 font-mono text-[length:var(--text-xs)] text-text-faint">
                فاصله‌های نشان‌داده‌شده بین توقف‌ها خط مستقیم است، نه مسیر جاده‌ای.
              </p>
            )}
            <ul className="print-day-sheet flex flex-col gap-2">
              {/* The hint sits between the two stops it concerns, not in a summary the
                  user has to translate back into "between which two?". afterIndex 0
                  means the leg from the origin, so it renders above the first stop. */}
              {restockHint && restockHint.afterIndex === 0 && (
                <li>
                  <RestockHint hint={restockHint} busy={optimising} onAdd={insertRestockStop} />
                </li>
              )}
              {dayPlans.map((p, i) => (
                <li key={p.id} className="flex flex-col gap-2">
                {legKm.has(p.id) && (
                  <div className="flex items-center gap-2 pe-6 font-mono text-[length:var(--text-xs)] text-text-faint">
                    <span aria-hidden="true" className="text-text-faint"><Icon name="arrow-down" size="sm" /></span>
                    <span>{formatDistanceKm(legKm.get(p.id) as number)}</span>
                    <span className="h-px flex-1 bg-border" aria-hidden="true" />
                  </div>
                )}
                <div
                  className="print-stop flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2"
                >
                  <div className="no-print flex flex-col gap-0.5">
                    <button
                      onClick={() => move(p.id, -1)}
                      disabled={i === 0}
                      aria-label="انتقال توقف به بالا"
                      className="text-text-faint hover:text-text disabled:opacity-30"
                    >
                      <Icon name="arrow-up" size="sm" />
                    </button>
                    <button
                      onClick={() => move(p.id, 1)}
                      disabled={i === dayPlans.length - 1}
                      aria-label="انتقال توقف به پایین"
                      className="text-text-faint hover:text-text disabled:opacity-30"
                    >
                      <Icon name="arrow-down" size="sm" />
                    </button>
                  </div>
                  <div className="min-w-0 flex-1 basis-32 truncate text-[length:var(--text-sm)] text-text">
                    {p.entity_type === "district" ? <Icon name="map" size="sm" /> : null}
                     {p.entity_type === "lead_location" ? <Icon name="map-pin" size="sm" className="text-accent" /> : null}{" "}
                    {p.label}
                  </div>
                  <span
                    className="shrink-0 rounded-[var(--radius-sm)] px-2 py-0.5 font-mono text-[length:var(--text-xs)]"
                    style={{
                      color: STATUS_META[p.status].color,
                      background: `color-mix(in srgb, ${STATUS_META[p.status].color} 16%, transparent)`,
                    }}
                  >
                    {STATUS_META[p.status].label}
                  </span>
                  <div className="no-print flex w-full flex-wrap justify-end gap-1 sm:w-auto">
                    {p.lat !== null && p.lng !== null && (
                      <a
                        href={navigateUrl(navAppId, { lat: p.lat, lng: p.lng }, p.label)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`مسیریابی به ${p.label}`}
                        className="rounded-[var(--radius-sm)] px-1.5 py-1 text-accent transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-white/5"
                      >
                        <Icon name="external-link" size="sm" />
                        <span className="ms-1 text-[length:var(--text-xs)]">مسیریابی</span>
                      </a>
                    )}
                    <button
                      onClick={() => setStatus(p.id, "done")}
                      className="rounded-[var(--radius-sm)] px-1.5 py-1 text-good transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-white/5"
                    >
                      <Icon name="check" size="sm" />
                      <span className="ms-1 text-[length:var(--text-xs)]">ثبت انجام توقف</span>
                    </button>
                    <button
                      onClick={() => setStatus(p.id, "skipped")}
                      className="rounded-[var(--radius-sm)] px-1.5 py-1 text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-white/5"
                    >
                      <Icon name="x" size="sm" />
                      <span className="ms-1 text-[length:var(--text-xs)]">رد کردن توقف</span>
                    </button>
                    <button
                      onClick={() => removePlan(p.id)}
                      className="rounded-[var(--radius-sm)] px-1.5 py-1 text-crit transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-white/5"
                    >
                      <Icon name="trash" size="sm" />
                      <span className="ms-1 text-[length:var(--text-xs)]">حذف از برنامه</span>
                    </button>
                  </div>
                </div>
                {restockHint && restockHint.afterIndex === i + 1 && (
                  <RestockHint hint={restockHint} busy={optimising} onAdd={insertRestockStop} />
                )}
                </li>
              ))}
              {returnLegKm !== null && origin && (
                <li className="flex items-center gap-2 pe-6 font-mono text-[length:var(--text-xs)] text-text-faint">
                  <span aria-hidden="true"><Icon name="arrow-down" size="sm" /></span>
                  <span>{formatDistanceKm(returnLegKm)}</span>
                  <span>بازگشت به {origin.label}</span>
                  <span className="h-px flex-1 bg-border" aria-hidden="true" />
                </li>
              )}
            </ul>
            </>
          )}
        </section>

        <div className="no-print">
          <PlannerRouteMap stops={routeStops} facilities={facilities} />
        </div>
      </div>
    </div>    </>
  );
}
