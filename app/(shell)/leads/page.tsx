"use client";

import { useRunAfterMount } from "@/lib/useRunAfterMount";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHydrated } from "@/lib/useHydrated";
import { useSession } from "@/lib/useSession";
import dynamic from "next/dynamic";
import Link from "next/link";
import { distanceKm, formatDistanceKm, routeLengthKm, twoOptOrder, RESORT_THRESHOLD_KM, type LatLng } from "@/lib/geo";
import { clusterIntoDays, daysNeeded } from "@/lib/clusterDays";
import { fetchOsrmTable } from "@/lib/routing/osrmMatrix";
import LeadImportPanel from "@/components/LeadImportPanel";
import { useToast } from "@/components/ToastProvider";
import { faNum } from "@/lib/format";
import { parseIdParam } from "@/lib/deepLink";
import { matchesQuery } from "@/lib/persian";
import { LeadPoint } from "@/components/LeadsMap";
import { Icon } from "@/components/meridian/Icon";
import CollapsibleSection from "@/components/CollapsibleSection";
import { SkeletonLabel, SkeletonRows } from "@/components/Skeleton";
import EmptyState from "@/components/EmptyState";
import NavAppSetting, { useNavApp } from "@/components/NavAppSetting";
import { navigateUrl, routeUrl } from "@/lib/navApps";
import { useMyPosition } from "@/components/MyPositionProvider";
import RunPanel, { type RunStop } from "@/components/leads/RunPanel";
import StarRating from "@/components/StarRating";
import LocationTapFlow from "@/components/leads/LocationTapFlow";
import LocationCard from "@/components/leads/LocationCard";
import RouteSection, { type DayGroup } from "@/components/leads/RouteSection";
import { LEAD_CRITERIA, LeadCriterion, averageScore, scoreOf } from "@/lib/leadScore";

const LeadsMap = dynamic(() => import("@/components/LeadsMap"), { ssr: false });
const LocationPinPicker = dynamic(() => import("@/components/LocationPinPicker"), { ssr: false });

type LocationStatus = "contacted" | "visited" | "no_answer" | "declined";

export const STATUS_META: Record<LocationStatus, string> = {
  contacted: "تماس گرفته شد",
  visited: "بازدید شد",
  no_answer: "پاسخ نداد",
  declined: "رد کرد",
};

export interface SavedLocation {
  id: number;
  name: string;
  maps_url: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  resolution: "direct" | "pluscode" | "nominatim" | "manual" | "unresolved";
  status: LocationStatus | null;
  rating_potential: number | null;
  rating_volume: number | null;
  rating_ease: number | null;
  created_at: string;
}

/** A location that has coordinates -- the only kind that can be routed to, clustered, or
 *  drawn. Narrowed once, at the boundary, so nothing downstream has to keep re-checking. */
type RoutableLocation = SavedLocation & { lat: number; lng: number };

interface LeadList {
  id: number;
  name: string;
  location_ids: number[];
}

type SortMode = "nearest" | "score" | "name" | "newest" | "status" | "route" | "priority";

const SORT_LABEL: Record<SortMode, string> = {
  nearest: "نزدیک‌ترین",
  score: "بهترین امتیاز",
  name: "نام",
  newest: "تازه‌ترین",
  status: "وضعیت",
  route: "ترتیب مسیر",
  priority: "اولویت",
};

const SORT_KEY = "coverage_lead_sort";

function readSortMode(): SortMode {
  try {
    const raw = localStorage.getItem(SORT_KEY);
    if (raw && Object.keys(SORT_LABEL).includes(raw)) return raw as SortMode;
  } catch {}
  return "nearest";
}

function saveSortMode(mode: SortMode) {
  try { localStorage.setItem(SORT_KEY, mode); } catch {}
}

/** The scratch run, for when no named list is selected. In localStorage so a route being
 *  driven survives the phone locking, the browser evicting the tab, or a restart at the
 *  third stop. */
const SCRATCH_KEY = "coverage_lead_run";

function readScratchRun(): number[] | null {
  try {
    const raw = localStorage.getItem(SCRATCH_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter((x): x is number => Number.isInteger(x)) : null;
  } catch {
    // Nothing worth recovering.
    return null;
  }
}

/** How far the user has to move before the "nearest" ordering is recomputed.
 *
 *  A GPS fix jitters by tens of metres while stationary. Re-sorting on every one of those
 *  would reshuffle the list under a thumb that is reaching for a row -- which is its own
 *  way of tapping the wrong restaurant. The list follows real movement, not noise. */

export default function LeadsPage() {
  const [locations, setLocations] = useState<SavedLocation[]>([]);
  const [lists, setLists] = useState<LeadList[]>([]);
  const [activeListId, setActiveListId] = useState<number | null>(null);
  const [run, setRun] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>(readSortMode);
  const [pinningId, setPinningId] = useState<number | null>(null);
  const [scoringId, setScoringId] = useState<number | null>(null);
  const [converting, setConverting] = useState<number | null>(null);
  const [tapFlowId, setTapFlowId] = useState<number | null>(null);
  const [stopsPerDay, setStopsPerDay] = useState(8);
  const [proposedDaysRaw, setProposedDays] = useState<RoutableLocation[][] | null>(null);
  const proposedDays: DayGroup[] | null = useMemo(() =>
    proposedDaysRaw
      ? proposedDaysRaw.map((day, i) => ({
          title: `روز ${i + 1}`,
          stops: day.map((d) => ({
            id: d.id,
            name: d.name,
            lat: d.lat ?? 0,
            lng: d.lng ?? 0,
            legKm: null,
          })),
          totalKm: null,
          completed: 0,
          total: day.length,
        }))
      : null,
    [proposedDaysRaw]
  );
  const { isManager, loading: sessionLoading } = useSession();
  const [selectedMapId, setSelectedMapId] = useState<number | null>(null);
  const [newListName, setNewListName] = useState("");
  const toast = useToast();
  const [navAppId] = useNavApp();
  const { position, status: posStatus, error: posError, retry: retryPosition } = useMyPosition();
   const [showManualPos, setShowManualPos] = useState(false);

  const [linkedId] = useState<number | undefined>(() =>
    typeof window === "undefined" ? undefined : parseIdParam(window.location.search, "l")
  );
  const linkedRef = useRef<HTMLLIElement>(null);

  // ---- position, held steady enough to sort against -------------------------------
  const [sortAnchor, setSortAnchor] = useState<{ lat: number; lng: number } | null>(null);
  // Follows the device only past the threshold, adjusted during render (React's way of
  // keeping state in step with a changing input). Below it the anchor, and so the order
  // of the list, stays put: GPS jitter never re-sorts it.
  if (position && (!sortAnchor || distanceKm(sortAnchor, position) >= RESORT_THRESHOLD_KM)) {
    setSortAnchor({ lat: position.lat, lng: position.lng });
  }

  // ---- loading ---------------------------------------------------------------------
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [locRes, listRes] = await Promise.all([fetch("/api/locations"), fetch("/api/lead-lists")]);
      const locData = await locRes.json();
      const listData = await listRes.json();
      setLocations(locData.locations ?? []);
      setLists(listData.lists ?? []);
    } catch {
      toast("خطا در بارگذاری", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useRunAfterMount(load);

  // The scratch run is restored once, on the first render after hydration: localStorage
  // does not exist on the server.
  const hydrated = useHydrated();
  const [scratchRestored, setScratchRestored] = useState(false);
  if (hydrated && !scratchRestored) {
    setScratchRestored(true);
    const saved = readScratchRun();
    if (saved) setRun(saved);
  }

  useEffect(() => {
    if (linkedId === undefined) return;
    linkedRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [linkedId, loading]);

  // Persist sort mode choice to localStorage.
  useEffect(() => { saveSortMode(sortMode); }, [sortMode]);

  const byId = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);

  // ---- the run ---------------------------------------------------------------------
  /** Persists a change to the run: to the active list if there is one, otherwise to the
   *  scratch slot. Written immediately rather than debounced -- these are one tap each,
   *  and a route half-saved when the phone dies is worse than a few extra requests. */
  const persistRun = useCallback(
    async (next: number[], listId: number | null) => {
      if (listId === null) {
        try {
          localStorage.setItem(SCRATCH_KEY, JSON.stringify(next));
        } catch {
          // Not persisted, but live for this session.
        }
        return;
      }
      try {
        const res = await fetch(`/api/lead-lists/${listId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ location_ids: next }),
        });
        if (!res.ok) throw new Error();
        setLists((prev) => prev.map((l) => (l.id === listId ? { ...l, location_ids: next } : l)));
      } catch {
        toast("تغییر مسیر ذخیره نشد", "error");
      }
    },
    [toast]
  );

  const updateRun = useCallback(
    (next: number[]) => {
      setRun(next);
      persistRun(next, activeListId);
    },
    [activeListId, persistRun]
  );

  const addToRun = useCallback(
    (id: number) => {
      const loc = byId.get(id);
      if (!loc || loc.lat === null || loc.lng === null) {
        toast("این مکان مختصات ندارد و نمی‌تواند در مسیر باشد.", "error");
        return;
      }
      if (run.includes(id)) return;
      updateRun([...run, id]);
    },
    [byId, run, updateRun, toast]
  );

  const removeFromRun = useCallback((id: number) => updateRun(run.filter((x) => x !== id)), [run, updateRun]);

  function moveInRun(id: number, dir: -1 | 1) {
    const i = run.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= run.length) return;
    const next = run.slice();
    [next[i], next[j]] = [next[j], next[i]];
    updateRun(next);
  }

  const runLocations = useMemo(
    () =>
      run
        .map((id) => byId.get(id))
        .filter((l): l is RoutableLocation => !!l && l.lat !== null && l.lng !== null),
    [run, byId]
  );

  const runOrigin = sortAnchor;

  /** Each stop with the distance from the one before it -- from the user's position for
   *  the first. A total says the run is long; the legs say which pair of stops made it
   *  long, which is the part you can act on. */
  const runStops = useMemo<RunStop[]>(() => {
    const out: RunStop[] = [];
    for (let i = 0; i < runLocations.length; i++) {
      const l = runLocations[i];
      const from = i === 0 ? runOrigin : runLocations[i - 1];
      out.push({
        id: l.id,
        name: l.name,
        lat: l.lat,
        lng: l.lng,
        legKm: from ? distanceKm(from, l) : null,
      });
    }
    return out;
  }, [runLocations, runOrigin]);

  const runTotalKm = useMemo(
    () => (runOrigin && runLocations.length ? routeLengthKm(runOrigin, runLocations, false) : null),
    [runOrigin, runLocations]
  );

  /** How much shorter an optimised order would be. Null when there is nothing to gain,
   *  so the button only appears when pressing it would do something. */
  const optimiseGain = useMemo(() => {
    if (!runOrigin || runLocations.length < 3) return null;
    const current = routeLengthKm(runOrigin, runLocations, false);
    const best = routeLengthKm(runOrigin, twoOptOrder(runLocations, runOrigin, false), false);
    if (current <= 0) return null;
    const pct = Math.round(((current - best) / current) * 100);
    return pct >= 5 ? pct : null;
  }, [runOrigin, runLocations]);

  function optimiseRun() {
    if (!runOrigin) return;
    updateRun(twoOptOrder(runLocations, runOrigin, false).map((l) => l.id));
    toast("ترتیب مسیر بهینه شد.", "success");
  }

  function clearRun() {
    const previous = run;
    updateRun([]);
    toast("مسیر خالی شد.", "info", { label: "بازگردان", onClick: () => updateRun(previous) });
  }

  // ---- named lists -----------------------------------------------------------------
  async function createList(name: string, ids: number[]) {
    const trimmed = name.trim();
    if (!trimmed) {
      toast("برای فهرست یک نام بنویسید", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/lead-lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, location_ids: ids }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error);
      setLists((prev) => [...prev, { id: data.id, name: trimmed, location_ids: ids }]);
      setActiveListId(data.id);
      setRun(ids);
      setNewListName("");
      toast(`فهرست «${trimmed}» ساخته شد.`, "success");
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : "خطا در ساخت فهرست", "error");
    } finally {
      setBusy(false);
    }
  }

  async function renameList(id: number, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setLists((prev) => prev.map((l) => (l.id === id ? { ...l, name: trimmed } : l)));
    try {
      const res = await fetch(`/api/lead-lists/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast("تغییر نام ذخیره نشد", "error");
      load();
    }
  }

  async function deleteList(id: number) {
    const doomed = lists.find((l) => l.id === id);
    try {
      const res = await fetch(`/api/lead-lists/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error();
      setLists((prev) => prev.filter((l) => l.id !== id));
      if (activeListId === id) {
        setActiveListId(null);
        setRun([]);
      }
      toast(`فهرست «${data.deleted.name}» حذف شد.`, "success", {
        label: "بازگردان",
        onClick: () => createList(data.deleted.name, data.deleted.location_ids),
      });
    } catch {
      toast(doomed ? `خطا در حذف «${doomed.name}»` : "خطا در حذف فهرست", "error");
    }
  }

  function openList(id: number | null) {
    setActiveListId(id);
    if (id === null) {
      try {
        const raw = localStorage.getItem(SCRATCH_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        setRun(Array.isArray(parsed) ? parsed.filter((x): x is number => Number.isInteger(x)) : []);
      } catch {
        setRun([]);
      }
      return;
    }
    setRun(lists.find((l) => l.id === id)?.location_ids ?? []);
  }

  // ---- automatic day split ---------------------------------------------------------
  const routable = useMemo(
    () =>
      locations.filter((l): l is RoutableLocation => l.lat !== null && l.lng !== null),
    [locations]
  );

  // ---- OSRM distance matrix for route-aware ordering -------------------------
  const [routeMatrix, setRouteMatrix] = useState<number[][] | null>(null);
  const osrmFetched = useRef(false);

  useEffect(() => {
    if (osrmFetched.current) return;
    const points = routable;
    if (points.length < 2 || points.length > 100) return;
    const controller = new AbortController();
    fetchOsrmTable(points, controller.signal).then((table) => {
      if (table) {
        setRouteMatrix(table.distances_km);
        osrmFetched.current = true;
      }
    });
    return () => controller.abort();
  }, [routable]);

  function proposeDays() {
    const k = daysNeeded(routable.length, stopsPerDay);
    if (k === 0) {
      toast("مکانی با مختصات برای تقسیم وجود ندارد.", "error");
      return;
    }
    // If we have an OSRM road-distance matrix, use it for 2-opt ordering;
    // otherwise fall back to haversine straight-line.
    const distanceFn = routeMatrix
      ? (() => {
          const idx = new Map(routable.map((l, i) => [`${l.lat},${l.lng}`, i]));
          return (a: LatLng, b: LatLng) => {
            const ai = idx.get(`${a.lat},${a.lng}`);
            const bi = idx.get(`${b.lat},${b.lng}`);
            if (ai === undefined || bi === undefined) return distanceKm(a, b);
            return routeMatrix[ai][bi] ?? distanceKm(a, b);
          };
        })()
      : undefined;
    setProposedDays(clusterIntoDays(routable, k, runOrigin, distanceFn).map((d) => d.stops));
  }

  // ---- the visible list ------------------------------------------------------------
  const withDistance = useMemo(
    () =>
      locations.map((l) => ({
        loc: l,
        km:
          sortAnchor && l.lat !== null && l.lng !== null
            ? distanceKm(sortAnchor, { lat: l.lat, lng: l.lng })
            : null,
      })),
    [locations, sortAnchor]
  );

  const visible = useMemo(() => {
    const filtered = withDistance.filter(
      ({ loc }) => matchesQuery(loc.name, query) || matchesQuery(loc.address ?? "", query)
    );

    const sorted = filtered.slice();
    if (sortMode === "nearest") {
      // Anything without coordinates cannot be near or far, so it sits at the end rather
      // than being silently treated as distance zero.
      sorted.sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity));
    } else if (sortMode === "score") {
      // Unrated last rather than first: an unrated place is an open question, and the
      // point of this ordering is to surface the answered ones you rated highly.
      sorted.sort(
        (a, b) =>
          (averageScore(b.loc) ?? -1) - (averageScore(a.loc) ?? -1) ||
          (a.km ?? Infinity) - (b.km ?? Infinity)
      );
    } else if (sortMode === "route" && routeMatrix && sortAnchor) {
      // Order by road distance from the nearest routable point to the sort anchor,
      // using the OSRM matrix if available.
      // Find nearest routable point to sortAnchor by straight-line distance
      let nearestIdx = 0;
      let nearestDist = Infinity;
      routable.forEach((l, i) => {
        const d = Math.sqrt((l.lat - sortAnchor.lat) ** 2 + (l.lng - sortAnchor.lng) ** 2);
        if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
      });
      sorted.sort((a, b) => {
        const ai = routable.findIndex((l) => l.id === a.loc.id);
        const bi = routable.findIndex((l) => l.id === b.loc.id);
        const distA = (ai >= 0 && routeMatrix[nearestIdx]) ? routeMatrix[nearestIdx][ai] ?? Infinity : Infinity;
        const distB = (bi >= 0 && routeMatrix[nearestIdx]) ? routeMatrix[nearestIdx][bi] ?? Infinity : Infinity;
        return distA - distB;
      });
    } else if (sortMode === "priority") {
      // Priority: rated higher first, then unvisited first.
      sorted.sort(
        (a, b) =>
          (averageScore(b.loc) ?? -1) - (averageScore(a.loc) ?? -1) ||
          (a.loc.status === "no_answer" ? 1 : 0) - (b.loc.status === "no_answer" ? 1 : 0)
      );
    } else if (sortMode === "name") {
      sorted.sort((a, b) => a.loc.name.localeCompare(b.loc.name, "fa"));
    } else if (sortMode === "newest") {
      sorted.sort((a, b) => b.loc.created_at.localeCompare(a.loc.created_at));
    } else {
      // Unvisited first: the ones still to do are the reason to open this page.
      const rank = (s: LocationStatus | null) => (s === null ? 0 : s === "no_answer" ? 1 : 2);
      sorted.sort((a, b) => rank(a.loc.status) - rank(b.loc.status) || (a.km ?? Infinity) - (b.km ?? Infinity));
    }
    return sorted;
  }, [withDistance, query, sortMode, routeMatrix, sortAnchor, routable]);

  // ---- map ------------------------------------------------------------------------
  const mapLeads = useMemo<LeadPoint[]>(
    () =>
      routable.map((l) => {
        const idx = run.indexOf(l.id);
        return {
          id: l.id,
          name: l.name,
          address: l.address,
          lat: l.lat,
          lng: l.lng,
          runIndex: idx === -1 ? null : idx + 1,
          km: sortAnchor ? distanceKm(sortAnchor, { lat: l.lat, lng: l.lng }) : null,
          statusLabel: l.status ? STATUS_META[l.status] : null,
        };
      }),
    [routable, run, sortAnchor]
  );

  const runPoints = useMemo<[number, number][]>(() => {
    const pts: [number, number][] = [];
    if (runOrigin && runLocations.length) pts.push([runOrigin.lat, runOrigin.lng]);
    runLocations.forEach((l) => pts.push([l.lat, l.lng]));
    return pts;
  }, [runOrigin, runLocations]);

  const runHref = useMemo(
    () => routeUrl(navAppId, runLocations.map((l) => ({ lat: l.lat, lng: l.lng })), runOrigin),
    [navAppId, runLocations, runOrigin]
  );

  // ---- row actions -----------------------------------------------------------------
  async function remove(id: number) {
    try {
      const res = await fetch(`/api/locations/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      // The database cascade already dropped it from every saved list; this keeps the
      // run on screen in step without a reload.
      setRun((prev) => prev.filter((x) => x !== id));
      toast("از فهرست حذف شد.", "info");
    } catch {
      toast("خطا در حذف", "error");
    } finally {
      load();
    }
  }

  async function savePin(id: number, lat: number, lng: number) {
    try {
      const res = await fetch(`/api/locations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lng }),
      });
      if (!res.ok) throw new Error();
      toast("موقعیت ثبت شد.", "success");
      setPinningId(null);
      load();
    } catch {
      toast("خطا در ثبت موقعیت", "error");
    }
  }

  /** One tap on one star. Applied locally first: the row must respond at the moment it
   *  is touched, at the kerb, on a connection that may be doing nothing at all. A failed
   *  write says so and reloads, rather than leaving a score on screen that is not saved. */
  async function setScore(id: number, key: LeadCriterion, value: number | null) {
    const column = key === "potential" ? "rating_potential" : key === "volume" ? "rating_volume" : "rating_ease";
    setLocations((prev) => prev.map((l) => (l.id === id ? { ...l, [column]: value } : l)));
    try {
      const res = await fetch(`/api/locations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast("امتیاز ذخیره نشد", "error");
      load();
    }
  }

  async function convertToCustomer(id: number) {
    setConverting(id);
    try {
      const res = await fetch(`/api/locations/${id}/convert`, { method: "POST" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      toast("به فهرست مشتریان اضافه شد.", "success");
      load();
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : "خطا در تبدیل به مشتری", "error");
    } finally {
      setConverting(null);
    }
  }

  const activeList = activeListId === null ? null : lists.find((l) => l.id === activeListId) ?? null;

  return (
    <>
    <div dir="rtl" className="pagewrap">
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-mono text-[length:var(--text-xs)] uppercase tracking-[0.12em] text-accent">
              Prospect Locations
            </div>
            <h1 className="text-[length:var(--text-xl)] font-bold text-text">فهرست مکان‌های پیشنهادی</h1>
          </div>
          <Link
            href="/map"
            className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-[length:var(--text-sm)] text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent hover:text-accent"
          >
            بازگشت به نقشه ←
          </Link>
        </div>

        {/* Where the ordering comes from, said out loud. A list that claims to be sorted
            by distance while the app has no position is a list that is lying. */}
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-[length:var(--text-xs)]">
          {posStatus === "active" && position ? (
            <span className="text-good">
              موقعیت شما زنده است — فهرست با حرکت شما به‌روز می‌شود (دقت {faNum(Math.round(position.accuracy))} متر)
            </span>
          ) : posStatus === "denied" ? (
            <>
              <span className="text-crit">{posError ?? "دسترسی به موقعیت داده نشده"}</span>
              <span className="text-text-faint">— بدون آن، ترتیب «نزدیک‌ترین» ممکن نیست.</span>
              <button
                onClick={retryPosition}
                className="rounded-[var(--radius-sm)] border border-border px-2 py-0.5 text-text-muted hover:border-accent hover:text-accent"
              >
                تلاش دوباره
              </button>
            </>
          ) : (
            <span className="text-text-muted">در حال یافتن موقعیت شما…</span>
          )}
        </div>

        <LeadImportPanel onAdded={load} />

        {/* ---- all leads (manager only) ------------------------------------------ */}
        {isManager && (
        <section className="rounded-[var(--radius-lg)] border border-border bg-surface-raised p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="sechead__title">
              همه مکان‌ها ({faNum(locations.length)})
            </h2>
            <button
              onClick={() => {
                const ids = visible
                  .filter(({ loc }) => loc.lat !== null && loc.lng !== null)
                  .map(({ loc }) => loc.id);
                const newIds = ids.filter((id) => !run.includes(id));
                if (newIds.length === 0) return;
                updateRun([...run, ...newIds]);
              }}
              className="rounded-[var(--radius-sm)] px-2 py-1 text-[length:var(--text-xs)] border border-accent text-accent hover:bg-accent hover:text-accent-ink transition-colors flex items-center gap-1"
            >
              <Icon name="check" size="sm" /> انتخاب همه
            </button>
            <div className="flex items-center gap-2">
              {sortAnchor ? (
                <span className="text-[length:var(--text-xs)] text-text-muted">نزدیک‌ترین</span>
              ) : (
                <button
                  onClick={() => setShowManualPos(true)}
                  className="rounded-[var(--radius-sm)] px-2 py-1 text-[length:var(--text-xs)] border border-border text-text-muted hover:border-accent hover:text-accent transition-colors flex items-center gap-1"
                >
                  <Icon name="locate" size="sm" /> تعیین موقعیت
                </button>
              )}
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                className="rounded-[var(--radius-sm)] border border-border bg-bg px-1.5 py-1 text-[length:var(--text-xs)] text-text-muted outline-none focus:border-accent"
                aria-label="ترتیب"
              >
                <option value="nearest">نزدیک‌ترین</option>
                <option value="score">امتیاز</option>
                <option value="name">نام</option>
                <option value="newest">تازه‌ترین</option>
                <option value="status">وضعیت</option>
                <option value="route">ترتیب مسیر</option>
                <option value="priority">اولویت</option>
              </select>
            </div>
          </div>

          <div className="mb-3 relative">
            <Icon
              name="search"
              size="sm"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-faint pointer-events-none"
              aria-hidden="true"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="جستجو در نام یا آدرس…"
              className="w-full rounded-[var(--radius-md)] border-2 border-border bg-surface px-10 py-2 text-[length:var(--text-sm)] text-text outline-none transition-[border-color] duration-[var(--dur-base)] ease-[var(--ease-out)] placeholder:text-text-faint focus:border-accent focus:ring-1 focus:ring-accent"
            />
          </div>

          {loading ? (
            <>
              <SkeletonRows rows={4} />
              <SkeletonLabel>در حال بارگذاری مکان‌ها…</SkeletonLabel>
            </>
          ) : locations.length === 0 ? (
            <EmptyState
              icon="map-pin"
              title="هنوز مکان پیشنهادی‌ای ذخیره نشده"
              hint="لینک یا نتیجه جستجوی گوگل‌مپس را در کادر بالا بچسبانید تا مکان‌های تازه برای بررسی اینجا جمع شوند."
            />
          ) : visible.length === 0 ? (
            <EmptyState icon="search" title="چیزی با این جستجو پیدا نشد" className="py-4" />
          ) : (
            <ul className="flex flex-col gap-1.5" role="list">
              {visible.map(({ loc: l, km }) => {
                const runIdx = run.indexOf(l.id);
                const inRun = runIdx !== -1;
                const avg = averageScore(l);
                const scoring = scoringId === l.id;
                const priorityHigh = avg !== null && avg >= 4;
                return (
                  <LocationCard
                    key={l.id}
                    location={l}
                    inRun={inRun}
                    navAppId={navAppId}
                    onPin={() => setPinningId(l.id)}
                    onNameChange={(name) => setLocations((prev) => prev.map((loc) => loc.id === l.id ? { ...loc, name } : loc))}
                    runIdx={inRun ? runIdx : null}
                    onToggleRun={() => (inRun ? removeFromRun(l.id) : addToRun(l.id))}
                    scoring={scoring}
                    onClickScoring={() => setScoringId(scoring ? null : l.id)}
                    priorityHigh={priorityHigh}
                    km={km}
                  />
                );
              })}
            </ul>
          )}

          {/* ---- scoring panel ------------------------------------------------- */}
          {scoringId !== null && (
            <div className="mt-3 rounded-[var(--radius-md)] border border-border bg-bg p-4">
              <h4 className="text-[length:var(--text-sm)] font-medium text-text mb-2">امتیازدهی به مکان</h4>
              {LEAD_CRITERIA.map((c) => {
                const loc = locations.find((l) => l.id === scoringId);
                return (
                  <div key={c.key} className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <span className="text-[length:var(--text-sm)] text-text">
                      <Icon name={c.icon} size="sm" /> {c.label}
                    </span>
                    <StarRating
                      value={scoreOf(loc ?? { id: 0, rating_potential: null, rating_volume: null, rating_ease: null }, c.key)}
                      label={c.label}
                      onChange={(v) => setScore(scoringId, c.key, v)}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {/* ---- pin picker overlay -------------------------------------------- */}
          {pinningId !== null && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setPinningId(null)}>
              <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-6 w-96 max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
                <h3 className="sechead__title mb-4">تعیین موقعیت روی نقشه</h3>
                <p className="text-[length:var(--text-sm)] text-text-muted mb-4">روی نقشه کلیک کنید تا موقعیت این مکان را تعیین کنید.</p>
                <LocationPinPicker
                  initial={null}
                  onConfirm={(lat, lng) => {
                    savePin(pinningId, lat, lng);
                    setPinningId(null);
                  }}
                  onCancel={() => setPinningId(null)}
                />
              </div>
            </div>
          )}
          {showManualPos && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowManualPos(false)}>
              <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-6 w-96 max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
                <h3 className="sechead__title mb-4">تعیین موقعیت</h3>
                <p className="text-[length:var(--text-sm)] text-text-muted mb-4">روی نقشه کلیک کنید تا موقعیت خود را روی نقشه تعیین کنید و لیست بر اساس نزدیکی به شما مرتب شود.</p>
                <LocationPinPicker
                  initial={null}
                  onConfirm={(lat, lng) => {
                    setSortAnchor({ lat, lng });
                    setShowManualPos(false);
                    toast("موقعیت ثبت شد", "success");
                  }}
                  onCancel={() => {
                    setShowManualPos(false);
                  }}
                />
              </div>
            </div>
          )}
        </section>
        )}

        {/* ---- automatic day split (manager only) -------------------------------- */}
        {isManager && (
        <section className="rounded-[var(--radius-lg)] border border-border bg-surface-raised p-4">
          <CollapsibleSection
            title="تقسیم خودکار بین روزها" icon="folders"
            storageKey="leads_split"
            keywords="خوشه‌بندی روز مسیر تقسیم"
          >
            <p className="mb-2 text-[length:var(--text-xs)] leading-5 text-text-faint">
              مکان‌ها را بر اساس نزدیکی جغرافیایی به روزها تقسیم می‌کند — نه فقط برش زدن یک فهرست مرتب‌شده.
              نتیجه یک پیشنهاد است؛ هر روزی را که پسندیدید می‌توانید به مسیر یا به یک فهرست تازه ببرید.
            </p>

            <div className="mb-3 flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-[length:var(--text-xs)] text-text-muted">
                تعداد توقف در هر روز:
                <input
                  type="number"
                  min={2}
                  max={50}
                  value={stopsPerDay}
                  onChange={(e) => setStopsPerDay(Math.max(2, Number(e.target.value) || 2))}
                  className="w-16 rounded-[var(--radius-sm)] border border-border bg-bg px-1.5 py-1 text-center text-text outline-none focus:border-accent"
                />
              </label>
              <button
                onClick={proposeDays}
                className="rounded-[var(--radius-sm)] border border-accent px-2 py-1 text-[length:var(--text-xs)] text-accent hover:bg-accent hover:text-accent-ink"
              >
                پیشنهاد بده ({faNum(daysNeeded(routable.length, stopsPerDay))} روز)
              </button>
              {proposedDays && (
                <button
                  onClick={() => setProposedDays(null)}
                  className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted hover:border-crit hover:text-crit"
                >
                  بستن پیشنهاد
                </button>
              )}
            </div>

            {proposedDays && (
              <div className="flex flex-col gap-2">
                {proposedDays.map((day, i) => {
                  const dayKm = runOrigin ? routeLengthKm(runOrigin, day, false) : null;
                  return (
                    <div key={i} className="rounded-[var(--radius-md)] border border-border bg-surface p-2.5">
                      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[length:var(--text-sm)] text-text">
                          روز {faNum(i + 1)} — {faNum(day.length)} توقف
                          {dayKm !== null && (
                            <span className="ms-2 font-mono text-[length:var(--text-xs)] text-text-faint">
                              {formatDistanceKm(dayKm)} خط مستقیم
                            </span>
                          )}
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            onClick={() => updateRun(day.map((d) => d.id))}
                            className="rounded-[var(--radius-sm)] border border-accent px-2 py-1 text-[length:var(--text-xs)] text-accent hover:bg-accent hover:text-accent-ink"
                          >
                            بردن به مسیر
                          </button>
                          <button
                            onClick={() => createList(`روز ${i + 1}`, day.map((d) => d.id))}
                            disabled={busy}
                            className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted hover:border-accent hover:text-accent disabled:opacity-50"
                          >
                            ذخیره به‌عنوان فهرست
                          </button>
                        </div>
                      </div>
                      <p className="truncate text-[length:var(--text-xs)] text-text-faint">
                        {day.map((d) => d.name).join(" ← ")}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </CollapsibleSection>
        </section>
        )}

        {/* ---- the route section ------------------------------------------------- */}
        <RouteSection
          run={run}
          runStops={runStops}
          totalKm={runTotalKm}
          navAppId={navAppId}
          routeHref={runHref}
          navigateHref={(s) => navigateUrl(navAppId, { lat: s.lat, lng: s.lng }, s.name)}
          onMove={moveInRun}
          onRemove={removeFromRun}
          onClear={clearRun}
          onOptimise={optimiseRun}
          optimiseGain={optimiseGain}
          busy={busy}
          proposedDays={proposedDays}
          onAddDayToRun={(dayIdx) => updateRun((proposedDaysRaw ?? [])[dayIdx].map((d) => d.id))}
          onCreateListFromDay={(title, ids) => createList(title, ids)}
          onTapFlow={(stopId) => setTapFlowId(stopId)}
        />

        {/* ---- the map ----------------------------------------------------------- */}
        <LeadsMap
          leads={mapLeads}
          runPoints={runPoints}
          onAddToRun={addToRun}
          onRemoveFromRun={removeFromRun}
          navigateHref={(l) => navigateUrl(navAppId, { lat: l.lat, lng: l.lng }, l.name)}
          selectedId={selectedMapId}
          onSelect={setSelectedMapId}
        />

        <section className="rounded-[var(--radius-lg)] border border-border bg-surface-raised p-4">
          <CollapsibleSection title="تنظیمات" icon="settings" storageKey="leads_settings" keywords="مسیریابی برنامه نشان بلد ویز گوگل">
            <NavAppSetting />
          </CollapsibleSection>
        </section>
      </div>
    </div>

      {/* ---- the tap-flow overlay ------------------------------------------------ */}
      <LocationTapFlow
        open={tapFlowId !== null}
        locationId={tapFlowId!}
        locationName={tapFlowId !== null ? (byId.get(tapFlowId)?.name ?? "") : ""}
        onClose={() => setTapFlowId(null)}
      />
    </>
  );
}
