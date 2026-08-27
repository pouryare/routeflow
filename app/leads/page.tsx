"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { distanceKm, formatDistanceKm, routeLengthKm, twoOptOrder } from "@/lib/geo";
import { clusterIntoDays, daysNeeded } from "@/lib/clusterDays";
import LeadImportPanel from "@/components/LeadImportPanel";
import { useToast } from "@/components/ToastProvider";
import { faNum } from "@/lib/format";
import { parseIdParam } from "@/lib/deepLink";
import { matchesQuery } from "@/lib/persian";
import CopyButton from "@/components/CopyButton";
import CollapsibleSection from "@/components/CollapsibleSection";
import { SkeletonLabel, SkeletonRows } from "@/components/Skeleton";
import EmptyState from "@/components/EmptyState";
import NavAppSetting, { useNavApp } from "@/components/NavAppSetting";
import { navigateUrl, routeUrl } from "@/lib/navApps";
import { useMyPosition } from "@/components/MyPositionProvider";
import RunPanel, { type RunStop } from "@/components/leads/RunPanel";
import StarRating from "@/components/StarRating";
import { LEAD_CRITERIA, LeadCriterion, averageScore, scoreOf } from "@/lib/leadScore";
import type { LeadPoint } from "@/components/LeadsMap";

const LeadsMap = dynamic(() => import("@/components/LeadsMap"), { ssr: false });
const LocationPinPicker = dynamic(() => import("@/components/LocationPinPicker"), { ssr: false });

type LocationStatus = "contacted" | "visited" | "no_answer" | "declined";

const STATUS_META: Record<LocationStatus, string> = {
  contacted: "تماس گرفته شد",
  visited: "بازدید شد",
  no_answer: "پاسخ نداد",
  declined: "رد کرد",
};

interface SavedLocation {
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

type SortMode = "nearest" | "score" | "name" | "newest" | "status";

const SORT_LABEL: Record<SortMode, string> = {
  nearest: "نزدیک‌ترین",
  score: "بهترین امتیاز",
  name: "نام",
  newest: "تازه‌ترین",
  status: "وضعیت",
};

/** The scratch run, for when no named list is selected. In localStorage so a route being
 *  driven survives the phone locking, the browser evicting the tab, or a restart at the
 *  third stop. */
const SCRATCH_KEY = "coverage_lead_run";

/** How far the user has to move before the "nearest" ordering is recomputed.
 *
 *  A GPS fix jitters by tens of metres while stationary. Re-sorting on every one of those
 *  would reshuffle the list under a thumb that is reaching for a row -- which is its own
 *  way of tapping the wrong restaurant. The list follows real movement, not noise. */
const RESORT_THRESHOLD_KM = 0.05;

export default function LeadsPage() {
  const [locations, setLocations] = useState<SavedLocation[]>([]);
  const [lists, setLists] = useState<LeadList[]>([]);
  const [activeListId, setActiveListId] = useState<number | null>(null);
  const [run, setRun] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("nearest");
  const [pinningId, setPinningId] = useState<number | null>(null);
  const [scoringId, setScoringId] = useState<number | null>(null);
  const [converting, setConverting] = useState<number | null>(null);
  const [stopsPerDay, setStopsPerDay] = useState(8);
  const [proposedDays, setProposedDays] = useState<RoutableLocation[][] | null>(null);
  const [selectedMapId, setSelectedMapId] = useState<number | null>(null);
  const [newListName, setNewListName] = useState("");
  const toast = useToast();
  const [navAppId] = useNavApp();
  const { position, status: posStatus, error: posError, retry: retryPosition } = useMyPosition();

  const [linkedId] = useState<number | undefined>(() =>
    typeof window === "undefined" ? undefined : parseIdParam(window.location.search, "l")
  );
  const linkedRef = useRef<HTMLLIElement>(null);

  // ---- position, held steady enough to sort against -------------------------------
  const [sortAnchor, setSortAnchor] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (!position) return;
    // Positions arrive asynchronously from the device; there is no render in which this
    // could be computed instead. Returning the previous object unchanged when the move
    // is below the threshold is what stops it re-rendering the list on GPS jitter.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSortAnchor((prev) => {
      if (prev && distanceKm(prev, position) < RESORT_THRESHOLD_KM) return prev;
      return { lat: position.lat, lng: position.lng };
    });
  }, [position]);

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

  useEffect(() => {
    // Fetch on mount. The setState is inside the async function, past its first
    // await; the rule sees only that the call starts synchronously. Moving the data
    // fetch out of an effect entirely is the real answer, and that is a data-layer
    // change rather than a lint fix.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // The scratch run is restored once, on mount, and only when no list is active.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SCRATCH_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setRun(parsed.filter((x): x is number => Number.isInteger(x)));
      }
    } catch {
      // Nothing worth recovering.
    }
  }, []);

  useEffect(() => {
    if (linkedId === undefined) return;
    linkedRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [linkedId, loading]);

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
      toast("برای لیست یک نام بنویسید", "error");
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
      toast(`لیست «${trimmed}» ساخته شد.`, "success");
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : "خطا در ساخت لیست", "error");
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
      toast(`لیست «${data.deleted.name}» حذف شد.`, "success", {
        label: "بازگردان",
        onClick: () => createList(data.deleted.name, data.deleted.location_ids),
      });
    } catch {
      toast(doomed ? `خطا در حذف «${doomed.name}»` : "خطا در حذف لیست", "error");
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

  function proposeDays() {
    const k = daysNeeded(routable.length, stopsPerDay);
    if (k === 0) {
      toast("مکانی با مختصات برای تقسیم وجود ندارد.", "error");
      return;
    }
    setProposedDays(clusterIntoDays(routable, k, runOrigin).map((d) => d.stops));
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
  }, [withDistance, query, sortMode]);

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
      toast("از لیست حذف شد.", "info");
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

  async function setStatus(id: number, status: LocationStatus | null) {
    setLocations((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));
    try {
      const res = await fetch(`/api/locations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast("خطا در ثبت وضعیت", "error");
      load();
    }
  }

  async function convertToCustomer(id: number) {
    setConverting(id);
    try {
      const res = await fetch(`/api/locations/${id}/convert`, { method: "POST" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      toast("به لیست مشتریان اضافه شد.", "success");
      load();
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : "خطا در تبدیل به مشتری", "error");
    } finally {
      setConverting(null);
    }
  }

  const activeList = activeListId === null ? null : lists.find((l) => l.id === activeListId) ?? null;

  return (
    <div dir="rtl" className="min-h-screen bg-bg p-4 sm:p-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-mono text-[length:var(--text-xs)] uppercase tracking-[0.12em] text-accent">
              Prospect Locations
            </div>
            <h1 className="text-[length:var(--text-xl)] font-bold text-text">لیست مکان‌های پیشنهادی</h1>
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

        {/* ---- the run ---------------------------------------------------------- */}
        <section className="rounded-[var(--radius-lg)] border border-border bg-surface-raised p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-muted">
              {activeList ? `مسیر: ${activeList.name}` : "مسیر فعلی"} ({faNum(run.length)})
            </h2>
            <div className="flex flex-wrap items-center gap-1.5">
              <select
                value={activeListId ?? ""}
                onChange={(e) => openList(e.target.value === "" ? null : Number(e.target.value))}
                aria-label="انتخاب لیست"
                className="rounded-[var(--radius-sm)] border border-border bg-surface px-2 py-1 text-[length:var(--text-xs)] text-text outline-none focus:border-accent"
              >
                <option value="">مسیر موقت (ذخیره‌نشده)</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.location_ids.length})
                  </option>
                ))}
              </select>
              {activeList && (
                <>
                  <button
                    onClick={() => {
                      const name = window.prompt("نام تازه لیست:", activeList.name);
                      if (name) renameList(activeList.id, name);
                    }}
                    className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted hover:border-accent hover:text-accent"
                  >
                    تغییر نام
                  </button>
                  <button
                    onClick={() => deleteList(activeList.id)}
                    className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted hover:border-crit hover:text-crit"
                  >
                    حذف لیست
                  </button>
                </>
              )}
            </div>
          </div>

          {run.length === 0 ? (
            <EmptyState
              icon="🧭"
              title="مسیری انتخاب نشده"
              hint="از فهرست پایین یا از روی نقشه، هر جایی را که می‌خواهید بروید بزنید. توقف‌ها دقیقاً به همان ترتیبی که انتخاب می‌کنید می‌مانند."
            />
          ) : (
            <RunPanel
              stops={runStops}
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
            />
          )}

          {run.length > 0 && activeListId === null && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createList(newListName, run);
              }}
              className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3"
            >
              <input
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                placeholder="نام این مسیر، مثلاً «شرق تهران»"
                className="min-w-40 flex-1 rounded-[var(--radius-sm)] border border-border bg-surface px-2 py-1.5 text-[length:var(--text-sm)] text-text outline-none focus:border-accent"
              />
              <button
                type="submit"
                disabled={busy}
                className="rounded-[var(--radius-sm)] border border-accent px-3 py-1.5 text-[length:var(--text-xs)] text-accent hover:bg-accent hover:text-accent-ink disabled:opacity-50"
              >
                ذخیره به‌عنوان لیست
              </button>
            </form>
          )}
        </section>

        {/* ---- automatic day split ---------------------------------------------- */}
        <section className="rounded-[var(--radius-lg)] border border-border bg-surface-raised p-4">
          <CollapsibleSection
            title="تقسیم خودکار بین روزها" icon="🗂"
            storageKey="leads_split"
            keywords="خوشه‌بندی روز مسیر تقسیم"
          >
            <p className="mb-2 text-[length:var(--text-xs)] leading-5 text-text-faint">
              مکان‌ها را بر اساس نزدیکی جغرافیایی به روزها تقسیم می‌کند — نه فقط برش زدن یک فهرست مرتب‌شده.
              نتیجه یک پیشنهاد است؛ هر روزی را که پسندیدید می‌توانید به مسیر یا به یک لیست تازه ببرید.
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
                            ذخیره به‌عنوان لیست
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

        {/* ---- all leads --------------------------------------------------------- */}
        <section className="rounded-[var(--radius-lg)] border border-border bg-surface-raised p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-muted">
              همه مکان‌ها ({faNum(locations.length)})
            </h2>
            <div className="flex gap-1 rounded-[var(--radius-md)] border border-border bg-surface p-1">
              {(Object.keys(SORT_LABEL) as SortMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setSortMode(m)}
                  disabled={m === "nearest" && !sortAnchor}
                  className={`rounded-[var(--radius-sm)] px-2 py-1 text-[length:var(--text-xs)] transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] disabled:opacity-40 ${
                    sortMode === m ? "bg-accent font-medium text-accent-ink" : "text-text-muted hover:bg-white/5 hover:text-text"
                  }`}
                >
                  {SORT_LABEL[m]}
                </button>
              ))}
            </div>
          </div>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="جستجو در نام یا آدرس…"
            className="mb-3 w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-[length:var(--text-sm)] text-text outline-none transition-[border-color] duration-[var(--dur-base)] ease-[var(--ease-out)] placeholder:text-text-faint focus:border-accent"
          />

          {loading ? (
            <>
              <SkeletonRows rows={4} />
              <SkeletonLabel>در حال بارگذاری مکان‌ها…</SkeletonLabel>
            </>
          ) : locations.length === 0 ? (
            <EmptyState
              icon="📍"
              title="هنوز مکان پیشنهادی‌ای ذخیره نشده"
              hint="لینک یا نتیجه جستجوی گوگل‌مپس را در کادر بالا بچسبانید تا مکان‌های تازه برای بررسی اینجا جمع شوند."
            />
          ) : visible.length === 0 ? (
            <EmptyState icon="🔍" title="چیزی با این جستجو پیدا نشد" className="py-4" />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {visible.map(({ loc: l, km }) => {
                const runIdx = run.indexOf(l.id);
                const inRun = runIdx !== -1;
                const avg = averageScore(l);
                const scoring = scoringId === l.id;
                return (
                  <li
                    key={l.id}
                    ref={l.id === linkedId ? linkedRef : undefined}
                    className={`flex flex-col gap-2 rounded-[var(--radius-md)] border bg-surface px-3 py-2 ${
                      l.id === linkedId || l.id === selectedMapId
                        ? "border-accent elevate-accent"
                        : inRun
                          ? "border-accent/40"
                          : "border-border"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {/* One tap adds it, in tap order. This is the whole difference from
                          a checkbox: a checkbox records membership, this records
                          sequence. */}
                      <button
                        onClick={() => (inRun ? removeFromRun(l.id) : addToRun(l.id))}
                        disabled={l.lat === null || l.lng === null}
                        aria-label={inRun ? `حذف ${l.name} از مسیر` : `افزودن ${l.name} به مسیر`}
                        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-[length:var(--text-xs)] transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] disabled:opacity-30 ${
                          inRun
                            ? "border-accent bg-accent text-accent-ink"
                            : "border-border text-text-muted hover:border-accent hover:text-accent"
                        }`}
                      >
                        {inRun ? faNum(runIdx + 1) : "+"}
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[length:var(--text-sm)] text-text">{l.name}</span>
                          {avg !== null && (
                            <span
                              className="shrink-0 font-mono text-[length:var(--text-xs)] text-warn"
                              title="میانگین امتیاز"
                            >
                              ★ {faNum(Math.round(avg * 10) / 10)}
                            </span>
                          )}
                          {km !== null ? (
                            <span className="shrink-0 font-mono text-[length:var(--text-xs)] text-accent">
                              {formatDistanceKm(km)}
                            </span>
                          ) : (
                            l.lat === null && (
                              <span className="shrink-0 text-[length:var(--text-xs)] text-warn">⚠ بدون مختصات</span>
                            )
                          )}
                        </div>
                        {l.address && <p className="truncate text-[length:var(--text-xs)] text-text-faint">{l.address}</p>}
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        {l.lat !== null && l.lng !== null && (
                          <a
                            href={navigateUrl(navAppId, { lat: l.lat, lng: l.lng }, l.name)}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`مسیریابی به ${l.name}`}
                            className="rounded-[var(--radius-sm)] px-1.5 py-1 text-accent transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-white/5"
                          >
                            ↗
                          </a>
                        )}
                        <CopyButton
                          value={() => `${window.location.origin}/leads?l=${l.id}`}
                          what="کپی پیوند این مکان"
                        />
                        <button
                          onClick={() => remove(l.id)}
                          aria-label="حذف"
                          className="rounded-[var(--radius-sm)] px-1.5 py-1 text-crit transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-white/5"
                        >
                          🗑
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 ps-9">
                      <select
                        value={l.status ?? ""}
                        onChange={(e) => setStatus(l.id, (e.target.value || null) as LocationStatus | null)}
                        className="rounded-[var(--radius-sm)] border border-border bg-bg px-1.5 py-1 text-[length:var(--text-xs)] text-text-muted outline-none focus:border-accent"
                      >
                        <option value="">بدون وضعیت</option>
                        {Object.entries(STATUS_META).map(([v, label]) => (
                          <option key={v} value={v}>
                            {label}
                          </option>
                        ))}
                      </select>

                      {/* Folded away by default. Three labelled star rows under every
                          entry would triple the height of a list whose job is to be
                          scanned, and scoring happens once per place while the list is
                          read many times. */}
                      <button
                        onClick={() => setScoringId(scoring ? null : l.id)}
                        aria-expanded={scoring}
                        className={`rounded-[var(--radius-sm)] border px-2 py-1 text-[length:var(--text-xs)] transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] ${
                          avg !== null
                            ? "border-warn/50 text-warn hover:border-warn"
                            : "border-border text-text-muted hover:border-accent hover:text-accent"
                        }`}
                      >
                        {scoring ? "بستن امتیاز" : avg !== null ? "★ امتیاز" : "☆ امتیازدهی"}
                      </button>

                      {l.lat === null ? (
                        <button
                          onClick={() => setPinningId(pinningId === l.id ? null : l.id)}
                          className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted hover:border-accent hover:text-accent"
                        >
                          {pinningId === l.id ? "بستن نقشه" : "📍 تعیین موقعیت روی نقشه"}
                        </button>
                      ) : (
                        <button
                          onClick={() => convertToCustomer(l.id)}
                          disabled={converting === l.id}
                          className="rounded-[var(--radius-sm)] border border-good px-2 py-1 text-[length:var(--text-xs)] text-good hover:bg-good/10 disabled:opacity-50"
                        >
                          {converting === l.id ? "در حال تبدیل…" : "✓ تبدیل به مشتری"}
                        </button>
                      )}
                    </div>

                    {scoring && (
                      <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-border bg-bg px-3 py-2.5">
                        {LEAD_CRITERIA.map((c) => (
                          <div key={c.key} className="flex flex-wrap items-center justify-between gap-2">
                            <span className="min-w-0">
                              <span className="block text-[length:var(--text-sm)] text-text">
                                <span aria-hidden="true" className="me-1">
                                  {c.icon}
                                </span>
                                {c.label}
                              </span>
                              {/* "4 out of 5" only means something if two people would
                                  agree what it is 4 out of. */}
                              <span className="block text-[length:var(--text-xs)] text-text-faint">{c.hint}</span>
                            </span>
                            <StarRating
                              value={scoreOf(l, c.key)}
                              label={c.label}
                              onChange={(v) => setScore(l.id, c.key, v)}
                            />
                          </div>
                        ))}
                        <p className="text-[length:var(--text-xs)] leading-5 text-text-faint">
                          برای پاک کردن یک امتیاز، روی همان ستاره دوباره بزنید.
                        </p>
                      </div>
                    )}

                    {pinningId === l.id && (
                      <LocationPinPicker
                        initial={null}
                        onConfirm={(lat, lng) => savePin(l.id, lat, lng)}
                        onCancel={() => setPinningId(null)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

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
          <CollapsibleSection title="تنظیمات" icon="⚙️" storageKey="leads_settings" keywords="مسیریابی برنامه نشان بلد ویز گوگل">
            <NavAppSetting />
          </CollapsibleSection>
        </section>
      </div>
    </div>
  );
}
