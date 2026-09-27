"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@/lib/useSession";
import { useRunAfterMount } from "@/lib/useRunAfterMount";
import { useHydrated } from "@/lib/useHydrated";
import { useToast } from "@/components/ToastProvider";
import { useNavApp } from "@/components/NavAppSetting";
import { useMyPosition } from "@/components/MyPositionProvider";
import { distanceKm, routeLengthKm, twoOptOrder } from "@/lib/geo";
import { clusterIntoDays, daysNeeded } from "@/lib/clusterDays";
import { averageScore } from "@/lib/leadScore";
import { matchesQuery } from "@/lib/persian";
import { parseIdParam } from "@/lib/deepLink";
import { routeUrl } from "@/lib/navApps";
import { assignableIds } from "@/lib/leadRunAssign";

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
  const [newListName, setNewListName] = useState("");
  const [selectedMapId, setSelectedMapId] = useState<number | null>(null);
  const [navAppId] = useNavApp();
  const { isManager, loading: sessionLoading } = useSession();
  const toast = useToast();
  const { position, status: posStatus, error: posError, retry: retryPosition } = useMyPosition();
  const [showManualPos, setShowManualPos] = useState(false);
  const [linkedId] = useState<number | undefined>(() => typeof window === "undefined" ? undefined : parseIdParam(window.location.search, "l"));
  const linkedRef = useRef<HTMLLIElement>(null);
  const [sortAnchor, setSortAnchor] = useState<{ lat: number; lng: number } | null>(null);
  if (position && (!sortAnchor || distanceKm(sortAnchor, position) >= RESORT_THRESHOLD_KM)) setSortAnchor({ lat: position.lat, lng: position.lng });
  const hydrated = useHydrated();
  const [scratchRestored, setScratchRestored] = useState(false);

  const byId = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);

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
     routes, so asking for them as a driver is two guaranteed 403s -- and the page used to
     fire them on mount before rendering anything. Skipping them keeps a driver's network
     clean and their console free of errors they can do nothing about. Their data comes
     from /api/lead-runs, in useDriverRun. */
  const load = useCallback(async () => {
    if (isManager === false) { setLoading(false); return; }
    setLoading(true);
    try { const [locRes, listRes] = await Promise.all([fetch("/api/locations"), fetch("/api/lead-lists")]); const locData = await locRes.json(); const listData = await listRes.json(); setLocations(locData.locations ?? []); setLists(listData.lists ?? []); } catch { toast("خطا در بارگذاری", "error"); } finally { setLoading(false); } }, [toast, isManager]);
  useRunAfterMount(load);
  const persistRun = useCallback(async (next: number[], listId: number | null) => { if (listId === null) { try { localStorage.setItem(SCRATCH_KEY, JSON.stringify(next)); } catch {} return; } try { const res = await fetch(`/api/lead-lists/${listId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location_ids: next }) }); if (!res.ok) throw new Error(); setLists((prev) => prev.map((l) => (l.id === listId ? { ...l, location_ids: next } : l))); } catch { toast("تغییر مسیر ذخیره نشد", "error"); } }, [toast]);
  const updateRun = useCallback((next: number[]) => { setRun(next); persistRun(next, activeListId); }, [activeListId, persistRun]);
  const addToRun = useCallback((id: number) => { const loc = byId.get(id); if (!loc || loc.lat === null || loc.lng === null) { toast("این مکان مختصات ندارد و نمی‌تواند در مسیر باشد.", "error"); return; } if (run.includes(id)) return; updateRun([...run, id]); }, [byId, run, updateRun, toast]);
  const removeFromRun = useCallback((id: number) => updateRun(run.filter((x) => x !== id)), [run, updateRun]);
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
  const optimiseGain = useMemo(() => { if (!runOrigin || runLocations.length < 3) return null; const current = routeLengthKm(runOrigin, runLocations, false); const best = routeLengthKm(runOrigin, twoOptOrder(runLocations, runOrigin, false), false); if (current <= 0) return null; const pct = Math.round(((current - best) / current) * 100); return pct >= 5 ? pct : null; }, [runOrigin, runLocations]);
  function optimiseRun() { if (!runOrigin) return; updateRun(twoOptOrder(runLocations, runOrigin, false).map((l) => l.id)); toast("ترتیب مسیر بهینه شد.", "success"); }
  function clearRun() { const previous = run; updateRun([]); toast("مسیر خالی شد.", "info", { label: "بازگردان", onClick: () => updateRun(previous) }); }
  async function createList(name: string, ids: number[]) { const trimmed = name.trim(); if (!trimmed) { toast("برای فهرست یک نام بنویسید", "error"); return; } setBusy(true); try { const res = await fetch("/api/lead-lists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: trimmed, location_ids: ids }) }); const data = await res.json(); if (!res.ok || !data.ok) throw new Error(data.error); setLists((prev) => [...prev, { id: data.id, name: trimmed, location_ids: ids }]); setActiveListId(data.id); setRun(ids); setNewListName(""); toast(`فهرست «${trimmed}» ساخته شد.`, "success"); } catch (e) { toast(e instanceof Error && e.message ? e.message : "خطا در ساخت فهرست", "error"); } finally { setBusy(false); } }
  async function renameList(id: number, name: string) { const trimmed = name.trim(); if (!trimmed) return; setLists((prev) => prev.map((l) => (l.id === id ? { ...l, name: trimmed } : l))); try { const res = await fetch(`/api/lead-lists/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: trimmed }) }); if (!res.ok) throw new Error(); } catch { toast("تغییر نام ذخیره نشد", "error"); load(); } }
  async function deleteList(id: number) { const doomed = lists.find((l) => l.id === id); try { const res = await fetch(`/api/lead-lists/${id}`, { method: "DELETE" }); const data = await res.json(); if (!res.ok || !data.ok) throw new Error(); setLists((prev) => prev.filter((l) => l.id !== id)); if (activeListId === id) { setActiveListId(null); setRun([]); } toast(`فهرست «${data.deleted.name}» حذف شد.`, "success", { label: "بازگردان", onClick: () => createList(data.deleted.name, data.deleted.location_ids) }); } catch { toast(doomed ? `خطا در حذف «${doomed.name}»` : "خطا در حذف فهرست", "error"); } }
  function openList(id: number | null) {
    setActiveListId(id);
    if (id === null) { try { const raw = localStorage.getItem(SCRATCH_KEY); const parsed = raw ? JSON.parse(raw) : []; setRun(stillAssignable(Array.isArray(parsed) ? parsed.filter((x): x is number => Number.isInteger(x)) : [])); } catch { setRun([]); } return; }
    setRun(stillAssignable(lists.find((l) => l.id === id)?.location_ids ?? []));
  }
  const routable = useMemo(() => locations.filter((l): l is RoutableLocation => l.lat !== null && l.lng !== null), [locations]);
  const togglePriority = useCallback((locationId: number) => { setLocations((prev) => prev.map((loc) => loc.id === locationId ? { ...loc, priority: !loc.priority } : loc)); }, []);
  function addToDayGroup(dayIdx: number, location: DayStop) { setProposedDays((prev) => { if (!prev) return [[location]]; if (prev[dayIdx]?.some((l) => l.id === location.id)) return prev; return prev.map((d, i) => (i === dayIdx ? [...d, location] : d)); }); }
  function removeFromDayGroup(dayIdx: number, locationId: number) { setProposedDays((prev) => { if (!prev) return null; const next = prev.map((d, i) => (i === dayIdx ? d.filter((l) => l.id !== locationId) : d)).filter((d) => d.length > 0); return next.length > 0 ? next : null; }); }
  const proposedDays = useMemo(() => proposedDaysRaw ? proposedDaysRaw.map((day, i) => ({ title: `روز ${i + 1}`, stops: day.map((d) => ({ id: d.id, name: d.name, lat: d.lat ?? 0, lng: d.lng ?? 0, legKm: null })), totalKm: null, completed: 0, total: day.length })) : null, [proposedDaysRaw]);
  const assignedIds = useMemo(() => new Set(proposedDaysRaw?.flat()?.map(l => l.id) ?? []), [proposedDaysRaw]);
  const unassignedLocations = useMemo(() => routable.filter((l) => !assignedIds.has(l.id)), [routable, assignedIds]);
  function proposeDays() { const k = daysNeeded(routable.length, stopsPerDay); if (k === 0) { toast("مکانی با مختصات برای تقسیم وجود ندارد.", "error"); return; } setProposedDays(clusterIntoDays(routable, k, runOrigin).map((d) => d.stops).sort((a, b) => b.length - a.length)); }
  const withDistance = useMemo(() => locations.map((l) => ({ loc: l, km: sortAnchor && l.lat !== null && l.lng !== null ? distanceKm(sortAnchor, { lat: l.lat, lng: l.lng }) : null })), [locations, sortAnchor]);
  const visible = useMemo(() => { const filtered = withDistance.filter(({ loc }) => matchesQuery(loc.name, query) || matchesQuery(loc.address ?? "", query)); const sorted = filtered.slice(); if (sortMode === "nearest") sorted.sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity)); else if (sortMode === "score") sorted.sort((a, b) => (averageScore(b.loc) ?? -1) - (averageScore(a.loc) ?? -1) || (a.km ?? Infinity) - (b.km ?? Infinity)); else if (sortMode === "priority") sorted.sort((a, b) => (averageScore(b.loc) ?? -1) - (averageScore(a.loc) ?? -1) || (a.loc.status === "no_answer" ? 1 : 0) - (b.loc.status === "no_answer" ? 1 : 0)); else if (sortMode === "name") sorted.sort((a, b) => a.loc.name.localeCompare(b.loc.name, "fa")); else if (sortMode === "newest") sorted.sort((a, b) => b.loc.created_at.localeCompare(a.loc.created_at)); else { const rank = (s: LocationStatus | null) => (s === null ? 0 : s === "no_answer" ? 1 : 2); sorted.sort((a, b) => rank(a.loc.status) - rank(b.loc.status) || (a.km ?? Infinity) - (b.km ?? Infinity)); } return sorted; }, [withDistance, query, sortMode]);
  const mapLeads = useMemo(() => routable.map((l) => { const idx = run.indexOf(l.id); return { id: l.id, name: l.name, address: l.address, lat: l.lat, lng: l.lng, runIndex: idx === -1 ? null : idx + 1, km: sortAnchor ? distanceKm(sortAnchor, { lat: l.lat, lng: l.lng }) : null, statusLabel: l.status ? STATUS_META[l.status ?? "no_answer"] : null }; }), [routable, run, sortAnchor]);
  const runPoints = useMemo(() => { const pts: [number, number][] = []; if (runOrigin && runLocations.length) pts.push([runOrigin.lat, runOrigin.lng]); runLocations.forEach((l) => pts.push([l.lat, l.lng])); return pts; }, [runOrigin, runLocations]);
  const runHref = useMemo(() => routeUrl(navAppId, runLocations.map((l) => ({ lat: l.lat, lng: l.lng })), runOrigin), [navAppId, runLocations, runOrigin]);
  const activeList = activeListId === null ? null : lists.find((l) => l.id === activeListId) ?? null;
  async function remove(id: number) { try { const res = await fetch(`/api/locations/${id}`, { method: "DELETE" }); if (!res.ok) throw new Error(); setRun((prev) => prev.filter((x) => x !== id)); toast("از فهرست حذف شد.", "info"); } catch { toast("خطا در حذف", "error"); } finally { load(); } }
  async function savePin(id: number, lat: number, lng: number) { try { const res = await fetch(`/api/locations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lat, lng }) }); if (!res.ok) throw new Error(); toast("موقعیت ثبت شد.", "success"); setPinningId(null); load(); } catch { toast("خطا در ثبت موقعیت", "error"); } }
  async function updateLocationName(id: number, name: string) { try { const res = await fetch(`/api/locations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) }); if (!res.ok) throw new Error(); toast("نام بروز شد.", "success"); load(); } catch { toast("خطا در بروز نام", "error"); } }
  async function convertToCustomer(id: number) { setConverting(id); try { const res = await fetch(`/api/locations/${id}/convert`, { method: "POST" }); const data = await res.json(); if (!data.ok) throw new Error(data.error); toast("به فهرست مشتریان اضافه شد.", "success"); load(); } catch (e) { toast(e instanceof Error && e.message ? e.message : "خطا در تبدیل به مشتری", "error"); } finally { setConverting(null); } }
  return { locations, lists, activeListId, run, loading, busy, query, sortMode, pinningId, setPinningId, converting, tapFlowId, setTapFlowId, stopsPerDay, proposedDaysRaw, newListName, selectedMapId, setSelectedMapId, isManager, sessionLoading, position, posStatus, posError, retryPosition, showManualPos, setShowManualPos, linkedId, linkedRef, sortAnchor, setSortAnchor, setLocations, setLists, setActiveListId, setRun, setQuery, setSortMode, setNewListName, setProposedDays, setStopsPerDay, load, createList, renameList, deleteList, openList, updateRun, addToRun, removeFromRun, moveInRun, optimiseRun, clearRun, proposeDays, togglePriority, addToDayGroup, removeFromDayGroup, remove, savePin, updateLocationName, convertToCustomer, runLocations, runStops, runTotalKm, optimiseGain, routable, unassignedLocations, visible, mapLeads, runPoints, runHref, activeList, lastAssigned: receipt, recordAssigned, byId };
}
