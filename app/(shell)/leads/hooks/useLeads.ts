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

type LocationStatus = "contacted" | "visited" | "no_answer" | "declined";
export const STATUS_META: Record<LocationStatus, string> = { contacted: "تماس گرفته شد", visited: "بازدید شد", no_answer: "پاسخ نداد", declined: "رد کرد" };
export interface SavedLocation { id: number; name: string; maps_url: string; address: string | null; lat: number | null; lng: number | null; notes: string | null; resolution: "direct" | "pluscode" | "nominatim" | "manual" | "unresolved"; status: LocationStatus | null; rating_potential: number | null; rating_volume: number | null; rating_ease: number | null; created_at: string; priority: boolean; organization_id: number | null; group_id: number | null; }
export type RoutableLocation = SavedLocation & { lat: number; lng: number };
interface LeadList { id: number; name: string; location_ids: number[]; }
type SortMode = "nearest" | "score" | "name" | "newest" | "status" | "route" | "priority";
const SORT_LABEL: Record<SortMode, string> = { nearest: "نزدیک‌ترین", score: "بهترین امتیاز", name: "نام", newest: "تازه‌ترین", status: "وضعیت", route: "ترتیب مسیر", priority: "اولویت" };
const SORT_KEY = "coverage_lead_sort"; const SCRATCH_KEY = "coverage_lead_run"; const RESORT_THRESHOLD_KM = 0.1;
function readSortMode(): SortMode { try { const raw = localStorage.getItem(SORT_KEY); if (raw && Object.keys(SORT_LABEL).includes(raw)) return raw as SortMode; } catch {} return "nearest"; }
function saveSortMode(mode: SortMode) { try { localStorage.setItem(SORT_KEY, mode); } catch {} }
function readScratchRun(): number[] | null { try { const raw = localStorage.getItem(SCRATCH_KEY); const parsed = raw ? JSON.parse(raw) : null; return Array.isArray(parsed) ? parsed.filter((x): x is number => Number.isInteger(x)) : null; } catch { return null; } }

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
  const [proposedDaysRaw, setProposedDays] = useState<RoutableLocation[][] | null>(null);
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
  if (hydrated && !scratchRestored) { setScratchRestored(true); const saved = readScratchRun(); if (saved) setRun(saved); }
  useEffect(() => { if (linkedId === undefined) return; linkedRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }, [linkedId, loading]);
  useEffect(() => { saveSortMode(sortMode); }, [sortMode]);
  const byId = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);
  const load = useCallback(async () => { setLoading(true); try { const [locRes, listRes] = await Promise.all([fetch("/api/locations"), fetch("/api/lead-lists")]); const locData = await locRes.json(); const listData = await listRes.json(); setLocations(locData.locations ?? []); setLists(listData.lists ?? []); } catch { toast("خطا در بارگذاری", "error"); } finally { setLoading(false); } }, [toast]);
  useRunAfterMount(load);
  const persistRun = useCallback(async (next: number[], listId: number | null) => { if (listId === null) { try { localStorage.setItem(SCRATCH_KEY, JSON.stringify(next)); } catch {} return; } try { const res = await fetch(`/api/lead-lists/${listId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location_ids: next }) }); if (!res.ok) throw new Error(); setLists((prev) => prev.map((l) => (l.id === listId ? { ...l, location_ids: next } : l))); } catch { toast("تغییر مسیر ذخیره نشد", "error"); } }, [toast]);
  const updateRun = useCallback((next: number[]) => { setRun(next); persistRun(next, activeListId); }, [activeListId, persistRun]);
  const addToRun = useCallback((id: number) => { const loc = byId.get(id); if (!loc || loc.lat === null || loc.lng === null) { toast("این مکان مختصات ندارد و نمی‌تواند در مسیر باشد.", "error"); return; } if (run.includes(id)) return; updateRun([...run, id]); }, [byId, run, updateRun, toast]);
  const removeFromRun = useCallback((id: number) => updateRun(run.filter((x) => x !== id)), [run, updateRun]);
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
  function openList(id: number | null) { setActiveListId(id); if (id === null) { try { const raw = localStorage.getItem(SCRATCH_KEY); const parsed = raw ? JSON.parse(raw) : []; setRun(Array.isArray(parsed) ? parsed.filter((x): x is number => Number.isInteger(x)) : []); } catch { setRun([]); } return; } setRun(lists.find((l) => l.id === id)?.location_ids ?? []); }
  const routable = useMemo(() => locations.filter((l): l is RoutableLocation => l.lat !== null && l.lng !== null), [locations]);
  const togglePriority = useCallback((locationId: number) => { setLocations((prev) => prev.map((loc) => loc.id === locationId ? { ...loc, priority: !loc.priority } : loc)); }, []);
  function addToDayGroup(dayIdx: number, location: RoutableLocation) { setProposedDays((prev) => { if (!prev) return [[location]]; if (prev[dayIdx]?.some((l) => l.id === location.id)) return prev; return prev.map((d, i) => (i === dayIdx ? [...d, location] : d)); }); }
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
  return { locations, lists, activeListId, run, loading, busy, query, sortMode, pinningId, setPinningId, converting, tapFlowId, setTapFlowId, stopsPerDay, proposedDaysRaw, newListName, selectedMapId, setSelectedMapId, isManager, sessionLoading, position, posStatus, posError, retryPosition, showManualPos, setShowManualPos, linkedId, linkedRef, sortAnchor, setSortAnchor, setLocations, setLists, setActiveListId, setRun, setQuery, setSortMode, setNewListName, setProposedDays, setStopsPerDay, load, createList, renameList, deleteList, openList, updateRun, addToRun, removeFromRun, moveInRun, optimiseRun, clearRun, proposeDays, togglePriority, addToDayGroup, removeFromDayGroup, remove, savePin, updateLocationName, convertToCustomer, runLocations, runStops, runTotalKm, optimiseGain, routable, visible, mapLeads, runPoints, runHref, activeList, byId };
}
