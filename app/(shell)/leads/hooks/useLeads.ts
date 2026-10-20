"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@/lib/useSession";
import { useRunAfterMount } from "@/lib/useRunAfterMount";
import { useHydrated } from "@/lib/useHydrated";
import { useToast } from "@/components/ToastProvider";
import { useNavApp } from "@/components/NavAppSetting";
import { useMyPosition } from "@/components/MyPositionProvider";
import { distanceKm, routeLengthKm, nearestNeighborOrder } from "@/lib/geo";
import { orderStops } from "@/lib/routing/orderStops";
import { clusterIntoDays, daysNeeded } from "@/lib/clusterDays";
import { averageScore } from "@/lib/leadScore";
import { matchesQuery } from "@/lib/persian";
import { parseIdParam } from "@/lib/deepLink";
import { routeUrl } from "@/lib/navApps";
import { assignableIds, resolveScope } from "@/lib/leadRunAssign";
import type { LeadRunAssignment } from "@/lib/repo/leadRuns";

type LocationStatus = "contacted" | "visited" | "no_answer" | "declined";
export const STATUS_META: Record<LocationStatus, string> = { contacted: "تماس گرفته شد", visited: "بازدید شد", no_answer: "پاسخ نداد", declined: "رد کرد" };
export interface SavedLocation { id: number; name: string; maps_url: string; address: string | null; lat: number | null; lng: number | null; notes: string | null; resolution: "direct" | "pluscode" | "nominatim" | "manual" | "unresolved"; status: LocationStatus | null; rating_potential: number | null; rating_volume: number | null; rating_ease: number | null; created_at: string; priority: boolean; organization_id: number | null; group_id: number | null; }
export type RoutableLocation = SavedLocation & { lat: number; lng: number };
/** All a day group needs: enough to name a stop, place it, and take its id. Declared
 *  rather than reusing `RoutableLocation` because the groups are filled two ways -- from
 *  `clusterIntoDays` (whole locations) and from a drag, which carries the card's projected
 *  `RunStop` -- and the day-split reads nothing else off a row. Typing the store as the
 *  full location let that second path push a `RunStop` into it, and the `any` in
 *  `RouteSection` was the only reason tsc never saw it. */
export interface DayStop { id: number; name: string; lat: number; lng: number; }
interface LeadList { id: number; name: string; location_ids: number[]; }
export type SortMode = "nearest" | "score" | "name" | "newest" | "status" | "route" | "priority";
const SORT_LABEL: Record<SortMode, string> = { nearest: "نزدیک‌ترین", score: "بهترین امتیاز", name: "نام", newest: "تازه‌ترین", status: "وضعیت", route: "ترتیب مسیر", priority: "اولویت" };
const SORT_KEY = "coverage_lead_sort"; const SCRATCH_KEY = "coverage_lead_run"; const RESORT_THRESHOLD_KM = 0.1;
function readSortMode(): SortMode { try { const raw = localStorage.getItem(SORT_KEY); if (raw && Object.keys(SORT_LABEL).includes(raw)) return raw as SortMode; } catch {} return "nearest"; }
function saveSortMode(mode: SortMode) { try { localStorage.setItem(SORT_KEY, mode); } catch {} }
function readScratchRun(): number[] | null { try { const raw = localStorage.getItem(SCRATCH_KEY); const parsed = raw ? JSON.parse(raw) : null; return Array.isArray(parsed) ? parsed.filter((x): x is number => Number.isInteger(x)) : null; } catch { return null; } }

/** Who the last hand-over went to, kept so an emptied pool is not an empty silence. The
 *  success toast is gone in five seconds; this is what a manager actually wants to know
 *  half an hour later, and `lead_runs` is the truth if they need more than one line.
 *
 *  Stored here rather than fetched, because it is one manager's own recent action on one
 *  device -- a shared receipt belongs in the run list, not in a manager's browser. */
export interface LastAssigned {
  driverName: string;
  runDate: string;
  stopCount: number;
}
const LAST_KEY = "coverage_last_assigned";
function readLastAssigned(): LastAssigned | null { try { const raw = localStorage.getItem(LAST_KEY); if (!raw) return null; const p = JSON.parse(raw); return p && typeof p.driverName === "string" && typeof p.runDate === "string" && Number.isInteger(p.stopCount) ? (p as LastAssigned) : null; } catch { return null; } }

export function useLeads() {
  const [locations, setLocations] = useState<SavedLocation[]>([]);
  const [lists, setLists] = useState<LeadList[]>([]);
  const [activeListId, setActiveListId] = useState<number | null>(null);
  const [run, setRun] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>(readSortMode);
  const [pinningId, setPinningId] = useState<number | null>(null);
  const [converting, setConverting] = useState<number | null>(null);
  const [tapFlowId, setTapFlowId] = useState<number | null>(null);
  const [stopsPerDay, setStopsPerDay] = useState(8);
  const [proposedDaysRaw, setProposedDays] = useState<DayStop[][] | null>(null);
  const [lastAssigned, setLastAssigned] = useState<LastAssigned | null>(readLastAssigned);
  /* Who holds what, and whether the manager wants to see it.
   *
   * `assignments` is the phone book from /api/lead-runs?assignments=1 -- one row per lead on
   * an unfinished route. Off by default, so the pool is the honest working set: a lead Reza
   * already has is not something to plan around.
   *
   * The filter this drives is deliberately in one place. The pool, the map, a fresh split
   * and the header count all read `available` below, and cannot drift apart -- a pool that
   * hid a lead while the split still offered it is the exact bug this fixes. */
  const [assignments, setAssignments] = useState<LeadRunAssignment[]>([]);
  const [showAssigned, setShowAssigned] = useState(false);
  const [assignmentsError, setAssignmentsError] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [selectedMapId, setSelectedMapId] = useState<number | null>(null);
  const [navAppId] = useNavApp();
  const { isManager, loading: sessionLoading } = useSession();
  const toast = useToast();
  const { position, status: posStatus, error: posError, retry: retryPosition } = useMyPosition();
  const [linkedId] = useState<number | undefined>(() => typeof window === "undefined" ? undefined : parseIdParam(window.location.search, "l"));
  const linkedRef = useRef<HTMLLIElement>(null);
  const [sortAnchor, setSortAnchor] = useState<{ lat: number; lng: number } | null>(null);
  if (position && (!sortAnchor || distanceKm(sortAnchor, position) >= RESORT_THRESHOLD_KM)) setSortAnchor({ lat: position.lat, lng: position.lng });
  const hydrated = useHydrated();
  const [scratchRestored, setScratchRestored] = useState(false);

  const byId = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);

  /* Newest wins, which is what "first row seen" already gives us: the endpoint orders by
     run_date DESC, id DESC. A lead on two unfinished routes is a data anomaly rather than a
     case to model, and picking the newest is at least deterministic. */
  const assignedBy = useMemo(() => {
    const m = new Map<number, { driverName: string | null; runDate: string }>();
    for (const a of assignments) if (!m.has(a.location_id)) m.set(a.location_id, { driverName: a.driver_name, runDate: a.run_date });
    return m;
  }, [assignments]);

  /* A saved list is just a row of ids, and an id can outlive the location it names. Loading
     one straight into the pool put a stop in front of a driver that the server would then
     refuse to save. `assignableIds` is the shared rule; see lib/leadRunAssign.ts.

     The `locations.length === 0` guard is load-bearing: until /api/locations answers, `byId`
     is empty, so every id looks stale and filtering then would silently empty a pool that was
     perfectly fine. Nothing is known yet, so nothing is dropped. */
  const stillAssignable = useCallback(
    (ids: number[]) => (locations.length === 0
      ? ids
      : assignableIds(ids, (locId) => { const l = byId.get(locId); return !!l && l.lat !== null && l.lng !== null; })),
    [byId, locations.length],
  );

  /* Read as a lazy initialiser, the way `sortMode` is, rather than in an effect. An effect
     here trips `setState synchronously within an effect`; reading it in the render body
     trips the compiler's memo-preservation rule on the `byId` above. Initialising once is what
     the file already does for its other persisted value.
     Hidden until hydration so the server render and the first client render agree -- the
     line appears a frame later, which is the whole cost of not being able to read
     localStorage on the server. */
  const receipt = hydrated ? lastAssigned : null;

  /* Restored raw, deliberately. This runs the moment hydration flips, which is before
     /api/locations has answered, so a filter here would see an empty map and drop the whole
     pool. Stale ids are caught at the two places that can actually act on them instead: the
     POST is handed `runLocations`, and `openList` filters once the locations are real. */
  if (hydrated && !scratchRestored) { setScratchRestored(true); const saved = readScratchRun(); if (saved) setRun(saved); }
  useEffect(() => { if (linkedId === undefined) return; linkedRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }, [linkedId, loading]);
  useEffect(() => { saveSortMode(sortMode); }, [sortMode]);
  /* A driver has no pool. /api/locations and /api/lead-lists are owner/group_manager
     routes, so asking for them as a driver is two guaranteed 403s. Since spec
     2026-09-29-leads-manager-only-driver-my-day section 3.2 the proxy refuses a van role
     at /leads, so this guard is dead in practice -- but it is kept, deliberately: a
     cached bundle or a third-party mount can still run this hook with a driver's
     session, and one wasted request is cheaper than a page of red console. The driver's
     own data no longer comes through here at all; it is on /driver. */
  const load = useCallback(async () => {
    if (isManager === false) { setLoading(false); return; }
    setLoading(true);
    try {
      const [locRes, listRes, assignRes] = await Promise.all([
        fetch("/api/locations"), fetch("/api/lead-lists"), fetch("/api/lead-runs?assignments=1"),
      ]);
      const locData = await locRes.json();
      const listData = await listRes.json();
      const assignData = await assignRes.json();
      setLocations(locData.locations ?? []);
      setLists(listData.lists ?? []);
      /* A failed phone book is NOT the same as an empty one, and must not be allowed to
         look like it: the server's 409 is what makes a mistaken hand-over safe, but the
         manager deserves to know the screen is showing them more than it really knows. */
      if (assignRes.ok && assignData.ok) { setAssignments(assignData.assignments ?? []); setAssignmentsError(false); }
      else { setAssignments([]); setAssignmentsError(true); }
    } catch { toast("مکان‌ها بارگذاری نشد؛ دوباره تلاش کنید", "error"); setAssignmentsError(true); } finally { setLoading(false); } }, [toast, isManager]);
  useRunAfterMount(load);
  const persistRun = useCallback(async (next: number[], listId: number | null) => { if (listId === null) { try { localStorage.setItem(SCRATCH_KEY, JSON.stringify(next)); } catch {} return; } try { const res = await fetch(`/api/lead-lists/${listId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location_ids: next }) }); if (!res.ok) throw new Error(); setLists((prev) => prev.map((l) => (l.id === listId ? { ...l, location_ids: next } : l))); } catch { toast("تغییر مسیر ذخیره نشد", "error"); } }, [toast]);
  const updateRun = useCallback((next: number[]) => { setRun(next); persistRun(next, activeListId); }, [activeListId, persistRun]);
  /* Naming the driver is the whole point of the refusal. "This lead is taken" leaves the
     manager to work out by whom; "this is Reza's" ends the question. It is a courtesy
     rather than the rule -- the server's 409 is what actually prevents the double-booking,
     and this only saves the round trip. */
  const refuseAssigned = useCallback((id: number): boolean => {
    const a = assignedBy.get(id);
    if (!a) return false;
    toast(a.driverName ? `این مکان در مسیر ${a.driverName} است.` : "این مکان در مسیر راننده دیگری است.", "error");
    return true;
  }, [assignedBy, toast]);
  const addToRun = useCallback((id: number) => { const loc = byId.get(id); if (!loc || loc.lat === null || loc.lng === null) { toast("این مکان مختصات ندارد و نمی‌تواند در مسیر باشد.", "error"); return; } if (run.includes(id)) return; if (refuseAssigned(id)) return; updateRun([...run, id]); }, [byId, run, updateRun, toast, refuseAssigned]);
  const removeFromRun = useCallback((id: number) => updateRun(run.filter((x) => x !== id)), [run, updateRun]);
  /** Appends a whole set to the route, keeping what is already there.
   *
   *  The additive twin of `openList`, which replaces the route outright. Two things it has
   *  to be honest about:
   *
   *  Ids already in the route are skipped rather than duplicated -- a list saved from a
   *  route and then appended back to that same route would otherwise grow by its own
   *  length every time.
   *
   *  Ids that no longer resolve are dropped. `openList` filters for the same reason, and
   *  the server would refuse the lot at save time with `مکان پیدا نشد` if they were not.
   *
   *  Returns how many were actually added, so the caller can say something useful when a
   *  list turns out to be entirely duplicates. */
  const appendToRun = useCallback((ids: number[]) => {
    const fresh = stillAssignable(ids).filter((id) => !run.includes(id));
    if (fresh.length > 0) updateRun([...run, ...fresh]);
    return fresh.length;
  }, [run, stillAssignable, updateRun]);

  /** Records the hand-over that just landed. Called from the assign flow's success path, so
   *  it only ever runs against a run the server actually accepted. */
  const recordAssigned = useCallback((next: LastAssigned) => {
    setLastAssigned(next);
    try { localStorage.setItem(LAST_KEY, JSON.stringify(next)); } catch {}
  }, []);
  function moveInRun(id: number, dir: -1 | 1) { const i = run.indexOf(id); const j = i + dir; if (i < 0 || j < 0 || j >= run.length) return; const next = run.slice(); [next[i], next[j]] = [next[j], next[i]]; updateRun(next); }
  const runLocations = useMemo(() => run.map((id) => byId.get(id)).filter((l): l is RoutableLocation => !!l && l.lat !== null && l.lng !== null), [run, byId]);
  const runOrigin = sortAnchor;
  const runStops = useMemo(() => { const out: { id: number; name: string; lat: number; lng: number; legKm: number | null }[] = []; for (let i = 0; i < runLocations.length; i++) { const l = runLocations[i]; const from = i === 0 ? runOrigin : runLocations[i - 1]; out.push({ id: l.id, name: l.name, lat: l.lat, lng: l.lng, legKm: from ? distanceKm(from, l) : null }); } return out; }, [runLocations, runOrigin]);
  const runTotalKm = useMemo(() => (runOrigin && runLocations.length ? routeLengthKm(runOrigin, runLocations, false) : null), [runOrigin, runLocations]);
  /* "Optimising would save N%".
   *
   * `best` is measured with the SAME algorithm the button will use -- nearest-neighbour plus
   * 2-opt, which is the fallback because VROOM_URL is unset in development. It used to call
   * twoOptOrder here too, so the number was honest; but computing it meant running the
   * ordering on every render of the route.
   *
   * The honest and cheap version: measure what the button would actually produce. If VROOM
   * is ever configured, this preview UNDERSTATES the gain rather than overstating it, which
   * is the safe direction to be wrong in -- the button still works and still reports which
   * algorithm ran. */
  const optimiseGain = useMemo(() => { if (!runOrigin || runLocations.length < 3) return null; const current = routeLengthKm(runOrigin, runLocations, false); if (current <= 0) return null; const best = routeLengthKm(runOrigin, nearestNeighborOrder(runLocations, runOrigin), false); const pct = Math.round(((current - best) / current) * 100); return pct >= 5 ? pct : null; }, [runOrigin, runLocations]);
  async function optimiseRun() { if (!runOrigin) return; const r = await orderStops(runLocations, runOrigin); updateRun(r.order.map((l) => l.id)); /* The toast tells the truth about which algorithm ran. VROOM_URL is unset in development, so today this is ALWAYS the fallback -- and the button used to claim "optimised" either way, which is the same class of lie as a precise-looking number that is not what it says. */ toast(r.quality === "solver" ? "ترتیب مسیر بهینه شد." : "ترتیب مسیر با روش نزدیک‌ترین چیده شد.", "success"); }
  function clearRun() { const previous = run; updateRun([]); toast("مسیر خالی شد.", "info", { label: "بازگردانی مسیر", onClick: () => updateRun(previous) }); }
  async function createList(name: string, ids: number[]) { const trimmed = name.trim(); if (!trimmed) { toast("برای فهرست یک نام بنویسید", "error"); return; } setBusy(true); try { const res = await fetch("/api/lead-lists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: trimmed, location_ids: ids }) }); const data = await res.json(); if (!res.ok || !data.ok) throw new Error(data.error); setLists((prev) => [...prev, { id: data.id, name: trimmed, location_ids: ids }]); setNewListName("");
    /* Deliberately NOT `setActiveListId`/`setRun` any more. The button reads "ذخیره به‌عنوان
       فهرست" -- save a copy -- and it was overwriting the route being built, which is how
       list #8 exists with zero stops. Loading is now the list bar's job, by an explicit tap. */ toast(`فهرست «${trimmed}» ساخته شد.`, "success"); } catch (e) { toast(e instanceof Error && e.message ? e.message : "خطا در ساخت فهرست", "error"); } finally { setBusy(false); } }
  async function renameList(id: number, name: string) { const trimmed = name.trim(); if (!trimmed) return; setLists((prev) => prev.map((l) => (l.id === id ? { ...l, name: trimmed } : l))); try { const res = await fetch(`/api/lead-lists/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: trimmed }) }); if (!res.ok) throw new Error(); } catch { toast("تغییر نام ذخیره نشد", "error"); load(); } }
  async function deleteList(id: number) { const doomed = lists.find((l) => l.id === id); try { const res = await fetch(`/api/lead-lists/${id}`, { method: "DELETE" }); const data = await res.json(); if (!res.ok || !data.ok) throw new Error(); setLists((prev) => prev.filter((l) => l.id !== id)); if (activeListId === id) { /* `updateRun`, not `setRun`: clearing the active list hands the pool back to scratch, and
   scratch is persisted. A raw set left `localStorage` holding the deleted list's ids, so a
   reload put the whole list straight back into the pool. */
    setActiveListId(null); updateRun([]); } toast(`فهرست «${data.deleted.name}» حذف شد.`, "success", { label: "بازگردانی فهرست", onClick: () => createList(data.deleted.name, data.deleted.location_ids) }); } catch { toast(doomed ? `خطا در حذف «${doomed.name}»` : "خطا در حذف فهرست", "error"); } }
  function openList(id: number | null) {
    setActiveListId(id);
    if (id === null) { try { const raw = localStorage.getItem(SCRATCH_KEY); const parsed = raw ? JSON.parse(raw) : []; setRun(stillAssignable(Array.isArray(parsed) ? parsed.filter((x): x is number => Number.isInteger(x)) : [])); } catch { setRun([]); } return; }
    setRun(stillAssignable(lists.find((l) => l.id === id)?.location_ids ?? []));
  }
  const routable = useMemo(() => locations.filter((l): l is RoutableLocation => l.lat !== null && l.lng !== null), [locations]);

  /* The pool's working set. Everything downstream -- the list, the map, a fresh split, the
     counts -- reads this rather than `routable`, so hiding a lead is a single decision made
     once. `proposedDaysRaw` is deliberately NOT filtered: a proposal is a draft being
     shaped, and stripping it would destroy a split the manager is still working on. */
  const available = useMemo(
    () => (showAssigned ? routable : routable.filter((l) => !assignedBy.has(l.id))),
    [routable, assignedBy, showAssigned],
  );
  /* The count of leads actually withheld, which is the difference in the working set rather
   * than `assignedBy.size`: a lead on a driver's route that never resolved to coordinates was
   * never in the pool to begin with, and promising to hide it would be a small lie. */
  const hiddenCount = showAssigned ? 0 : routable.length - available.length;
  const togglePriority = useCallback((locationId: number) => { setLocations((prev) => prev.map((loc) => loc.id === locationId ? { ...loc, priority: !loc.priority } : loc)); }, []);
  function addToDayGroup(dayIdx: number, location: DayStop) { setProposedDays((prev) => { if (!prev) return [[location]]; if (prev[dayIdx]?.some((l) => l.id === location.id)) return prev; return prev.map((d, i) => (i === dayIdx ? [...d, location] : d)); }); }
  function removeFromDayGroup(dayIdx: number, locationId: number) { setProposedDays((prev) => { if (!prev) return null; const next = prev.map((d, i) => (i === dayIdx ? d.filter((l) => l.id !== locationId) : d)).filter((d) => d.length > 0); return next.length > 0 ? next : null; }); }
  const proposedDays = useMemo(() => proposedDaysRaw ? proposedDaysRaw.map((day, i) => ({ title: `روز ${i + 1}`, stops: day.map((d) => ({ id: d.id, name: d.name, lat: d.lat ?? 0, lng: d.lng ?? 0, legKm: null })), totalKm: null, completed: 0, total: day.length })) : null, [proposedDaysRaw]);
  const assignedIds = useMemo(() => new Set(proposedDaysRaw?.flat()?.map(l => l.id) ?? []), [proposedDaysRaw]);
  const unassignedLocations = useMemo(() => available.filter((l) => !assignedIds.has(l.id)), [available, assignedIds]);
  /** Proposes days. With a `scope`, only those leads are considered.
   *
   *  Without one this works on the whole working set, which is what the «پیشنهاد بده» button
   *  means. With one it works on a single saved list, so a set saved for later can be split
   *  on its own terms instead of dragging the rest of the pool in with it.
   *
   *  The scope is intersected with `available` rather than trusted: an id that is not in the
   *  working set, or that another driver holds, cannot be smuggled in by naming a list. */
  function proposeDays(scope?: number[]) {
    const pool = resolveScope(scope, available);
    const k = daysNeeded(pool.length, stopsPerDay);
    /* The old message -- "no location with coordinates" -- was true and useless here: the
       leads exist, they are just all spoken for. Say so, and point at the toggle. */
    if (k === 0) { toast(available.length === 0 && assignedBy.size > 0 ? "همه مکان‌ها در مسیر رانندگان دیگر هستند. برای پیشنهاد روز، «نمایش مکان‌های سپرده‌شده» را روشن کنید." : "مکانی با مختصات برای تقسیم وجود ندارد.", "error"); return; }
    /* `stopsPerDay` is passed as the cap, and not just used to work out `k`. Leaving it out
       made the cap `ceil(n / k)`, which is not the number the manager typed: 8 a day from 10
       stops came back 5 and 5. The result is also no longer sorted biggest-first, which was
       hiding which day was the short one by putting it last anyway. */
    setProposedDays(clusterIntoDays(pool, k, runOrigin, undefined, undefined, stopsPerDay).map((d) => d.stops));
  }
  const withDistance = useMemo(() => available.map((l) => ({ loc: l, km: sortAnchor ? distanceKm(sortAnchor, { lat: l.lat, lng: l.lng }) : null })), [available, sortAnchor]);
  const visible = useMemo(() => { const filtered = withDistance.filter(({ loc }) => matchesQuery(loc.name, query) || matchesQuery(loc.address ?? "", query)); const sorted = filtered.slice(); if (sortMode === "nearest") sorted.sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity)); else if (sortMode === "score") sorted.sort((a, b) => (averageScore(b.loc) ?? -1) - (averageScore(a.loc) ?? -1) || (a.km ?? Infinity) - (b.km ?? Infinity)); else if (sortMode === "priority") sorted.sort((a, b) => (averageScore(b.loc) ?? -1) - (averageScore(a.loc) ?? -1) || (a.loc.status === "no_answer" ? 1 : 0) - (b.loc.status === "no_answer" ? 1 : 0)); else if (sortMode === "name") sorted.sort((a, b) => a.loc.name.localeCompare(b.loc.name, "fa")); else if (sortMode === "newest") sorted.sort((a, b) => b.loc.created_at.localeCompare(a.loc.created_at)); else { const rank = (s: LocationStatus | null) => (s === null ? 0 : s === "no_answer" ? 1 : 2); sorted.sort((a, b) => rank(a.loc.status) - rank(b.loc.status) || (a.km ?? Infinity) - (b.km ?? Infinity)); } return sorted; }, [withDistance, query, sortMode]);
  const mapLeads = useMemo(() => available.map((l) => { const idx = run.indexOf(l.id); return { id: l.id, name: l.name, address: l.address, lat: l.lat, lng: l.lng, runIndex: idx === -1 ? null : idx + 1, km: sortAnchor ? distanceKm(sortAnchor, { lat: l.lat, lng: l.lng }) : null, statusLabel: l.status ? STATUS_META[l.status ?? "no_answer"] : null }; }), [available, run, sortAnchor]);
  const runPoints = useMemo(() => { const pts: [number, number][] = []; if (runOrigin && runLocations.length) pts.push([runOrigin.lat, runOrigin.lng]); runLocations.forEach((l) => pts.push([l.lat, l.lng])); return pts; }, [runOrigin, runLocations]);
  const runHref = useMemo(() => routeUrl(navAppId, runLocations.map((l) => ({ lat: l.lat, lng: l.lng })), runOrigin), [navAppId, runLocations, runOrigin]);
  const activeList = activeListId === null ? null : lists.find((l) => l.id === activeListId) ?? null;
  async function remove(id: number) { try { const res = await fetch(`/api/locations/${id}`, { method: "DELETE" }); if (!res.ok) throw new Error(); setRun((prev) => prev.filter((x) => x !== id)); toast("از فهرست حذف شد.", "info"); } catch { toast("مکان حذف نشد؛ دوباره تلاش کنید", "error"); } finally { load(); } }
  async function savePin(id: number, lat: number | null, lng: number | null) { try { const res = await fetch(`/api/locations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lat, lng }) }); if (!res.ok) throw new Error(); toast(lat === null ? "موقعیت پاک شد." : "موقعیت ثبت شد.", "success"); setPinningId(null); load(); } catch { toast("موقعیت ثبت نشد؛ دوباره تلاش کنید", "error"); } }
  async function updateLocationName(id: number, name: string) { try { const res = await fetch(`/api/locations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) }); if (!res.ok) throw new Error(); toast("نام به‌روز شد.", "success"); load(); } catch { toast("نام تغییر نکرد؛ دوباره تلاش کنید", "error"); } }
  async function convertToCustomer(id: number) { setConverting(id); try { const res = await fetch(`/api/locations/${id}/convert`, { method: "POST" }); const data = await res.json(); if (!data.ok) throw new Error(data.error); toast("به فهرست مشتریان اضافه شد.", "success"); load(); } catch (e) { toast(e instanceof Error && e.message ? e.message : "تبدیل به مشتری انجام نشد؛ دوباره تلاش کنید", "error"); } finally { setConverting(null); } }
  return { locations, lists, activeListId, run, loading, busy, query, sortMode, pinningId, setPinningId, converting, tapFlowId, setTapFlowId, stopsPerDay, proposedDaysRaw, newListName, selectedMapId, setSelectedMapId, isManager, sessionLoading, position, posStatus, posError, retryPosition, linkedId, linkedRef, sortAnchor, setSortAnchor, setLocations, setLists, setActiveListId, setRun, setQuery, setSortMode, setNewListName, setProposedDays, setStopsPerDay, load, createList, renameList, deleteList, openList, updateRun, addToRun, removeFromRun, moveInRun, optimiseRun, clearRun, proposeDays, appendToRun, refuseAssigned, togglePriority, addToDayGroup, removeFromDayGroup, remove, savePin, updateLocationName, convertToCustomer, runLocations, runStops, runTotalKm, optimiseGain, routable, unassignedLocations, available, hiddenCount, visible, mapLeads, runPoints, runHref, activeList, lastAssigned: receipt, recordAssigned, byId, assignedBy, showAssigned, setShowAssigned, assignmentsError, toast };
}
