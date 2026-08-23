"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { nearestNeighborOrder } from "@/lib/geo";
import type { RouteStop } from "@/components/PlannerRouteMap";
import LeadImportPanel from "@/components/LeadImportPanel";
import { useToast } from "@/components/ToastProvider";
import { faNum } from "@/lib/format";
import { SkeletonLabel, SkeletonRows } from "@/components/Skeleton";

const PlannerRouteMap = dynamic(() => import("@/components/PlannerRouteMap"), { ssr: false });
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
  created_at: string;
}

function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export default function LeadsPage() {
  const [locations, setLocations] = useState<SavedLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  // Every routable location starts selected -- tracking exclusions instead of
  // inclusions means a freshly-added or freshly-loaded location is selected by
  // default with no extra bookkeeping, while a deliberate uncheck sticks across
  // reloads (search, delete) instead of being silently forgotten.
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [myPos, setMyPos] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [pinningId, setPinningId] = useState<number | null>(null);
  const [converting, setConverting] = useState<number | null>(null);
  const [stopsPerDay, setStopsPerDay] = useState(8);
  const [activeDay, setActiveDay] = useState<number | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/locations${query ? `?q=${encodeURIComponent(query)}` : ""}`);
    const data = await res.json();
    setLocations(data.locations ?? []);
    setLoading(false);
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(id: number) {
    try {
      const res = await fetch(`/api/locations/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast("از لیست حذف شد.", "info");
    } catch {
      toast("خطا در حذف", "error");
    } finally {
      load();
    }
  }

  function toggle(id: number) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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

  function locate() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMyPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
        toast("موقعیت شما به‌عنوان نقطه شروع مسیر تنظیم شد.", "success");
      },
      () => {
        setLocating(false);
        toast("دسترسی به موقعیت مکانی ممکن نشد.", "error");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  const routableSelected = useMemo(
    () =>
      locations.filter(
        (l): l is SavedLocation & { lat: number; lng: number } =>
          !excluded.has(l.id) && l.lat !== null && l.lng !== null
      ),
    [locations, excluded]
  );

  // Full nearest-neighbor pass over every selected stop, from the user's position when
  // known -- this order is already geographically coherent, so slicing it into
  // contiguous chunks (below) gives sensible day groupings without a separate
  // clustering step.
  const allOrdered = useMemo(() => {
    if (routableSelected.length === 0) return [];
    return nearestNeighborOrder(routableSelected, myPos);
  }, [routableSelected, myPos]);

  const dayChunks = useMemo(() => chunk(allOrdered, stopsPerDay), [allOrdered, stopsPerDay]);
  const isSplit = dayChunks.length > 1;

  // Re-running nearest-neighbor within just the active day's chunk (still from myPos)
  // keeps that day's own route tight, rather than inheriting an order optimized for
  // the combined multi-day set.
  const orderedStops = useMemo(() => {
    if (!isSplit || activeDay === null) return allOrdered;
    const day = dayChunks[activeDay] ?? [];
    return nearestNeighborOrder(day, myPos);
  }, [isSplit, activeDay, dayChunks, allOrdered, myPos]);

  const routeUrl = useMemo(() => {
    if (orderedStops.length === 0) return null;
    const destination = orderedStops[orderedStops.length - 1];
    const routeStops = myPos ? orderedStops : orderedStops.slice(1);
    const origin = myPos ? `${myPos.lat},${myPos.lng}` : `${orderedStops[0].lat},${orderedStops[0].lng}`;
    const waypoints = routeStops.slice(0, -1);
    if (routeStops.length === 0) return null;

    const params = new URLSearchParams({
      api: "1",
      origin,
      destination: `${destination.lat},${destination.lng}`,
      travelmode: "driving",
    });
    if (waypoints.length) params.set("waypoints", waypoints.map((s) => `${s.lat},${s.lng}`).join("|"));
    return `https://www.google.com/maps/dir/?${params.toString()}`;
  }, [orderedStops, myPos]);

  const routeStops = useMemo<RouteStop[]>(() => {
    if (orderedStops.length === 0) return [];
    const stops: RouteStop[] = [];
    if (myPos) stops.push({ lat: myPos.lat, lng: myPos.lng, label: "موقعیت من" });
    orderedStops.forEach((s) => stops.push({ lat: s.lat, lng: s.lng, label: s.name }));
    return stops;
  }, [orderedStops, myPos]);

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
            href="/"
            className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-[length:var(--text-sm)] text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent hover:text-accent"
          >
            بازگشت به نقشه ←
          </Link>
        </div>

        <LeadImportPanel onAdded={load} />

        <section className="rounded-[var(--radius-lg)] border border-border bg-surface-raised p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-muted">
              لیست ذخیره‌شده ({faNum(locations.length)})
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={locate}
                disabled={locating}
                className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent hover:text-accent disabled:opacity-50"
              >
                {locating ? "در حال یافتن…" : myPos ? "موقعیت من ✓" : "موقعیت من"}
              </button>
              {routeUrl && (
                <a
                  href={routeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-[var(--radius-sm)] border border-accent bg-accent px-2 py-1 text-[length:var(--text-xs)] font-medium text-[#04191c] transition-[filter,transform] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:scale-[1.03] hover:brightness-110 active:scale-[0.98]"
                >
                  شروع مسیر با {faNum(orderedStops.length)} توقف ↗
                </a>
              )}
            </div>
          </div>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="جستجو در نام یا آدرس…"
            className="mb-3 w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-[length:var(--text-sm)] text-text outline-none transition-[border-color] duration-[var(--dur-base)] ease-[var(--ease-out)] placeholder:text-text-faint focus:border-accent"
          />

          {routableSelected.length > 1 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2">
              <label className="flex items-center gap-1.5 text-[length:var(--text-xs)] text-text-muted">
                تعداد توقف در هر روز:
                <input
                  type="number"
                  min={2}
                  max={50}
                  value={stopsPerDay}
                  onChange={(e) => {
                    setStopsPerDay(Math.max(2, Number(e.target.value) || 2));
                    setActiveDay(null);
                  }}
                  className="w-14 rounded-[var(--radius-sm)] border border-border bg-bg px-1.5 py-0.5 text-center text-text outline-none focus:border-accent"
                />
              </label>
              {isSplit && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    onClick={() => setActiveDay(null)}
                    className={`rounded-[var(--radius-sm)] border px-2 py-0.5 text-[length:var(--text-xs)] transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] ${
                      activeDay === null ? "border-accent text-accent" : "border-border text-text-muted hover:border-accent hover:text-accent"
                    }`}
                  >
                    همه ({faNum(allOrdered.length)})
                  </button>
                  {dayChunks.map((d, i) => (
                    <button
                      key={i}
                      onClick={() => setActiveDay(i)}
                      className={`rounded-[var(--radius-sm)] border px-2 py-0.5 text-[length:var(--text-xs)] transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] ${
                        activeDay === i ? "border-accent text-accent" : "border-border text-text-muted hover:border-accent hover:text-accent"
                      }`}
                    >
                      روز {faNum(i + 1)} ({faNum(d.length)})
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {loading ? (
            <>
              <SkeletonRows rows={4} />
              <SkeletonLabel>در حال بارگذاری مکان‌ها…</SkeletonLabel>
            </>
          ) : locations.length === 0 ? (
            <p className="text-[length:var(--text-sm)] text-text-faint">لیست خالی است. از بخش بالا مکان اضافه کنید.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {locations.map((l) => (
                <li
                  key={l.id}
                  className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2"
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={!excluded.has(l.id)}
                      onChange={() => toggle(l.id)}
                      disabled={l.lat === null || l.lng === null}
                      className="mt-1 accent-[color:var(--accent)]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[length:var(--text-sm)] text-text">{l.name}</span>
                        {l.lat === null && <span className="shrink-0 text-[length:var(--text-xs)] text-warn">⚠ بدون مختصات</span>}
                      </div>
                      {l.address && <p className="truncate text-[length:var(--text-xs)] text-text-faint">{l.address}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <a
                        href={l.maps_url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="باز کردن در نقشه اصلی"
                        className="rounded-[var(--radius-sm)] px-1.5 py-1 text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-white/5 hover:text-accent"
                      >
                        ↗
                      </a>
                      <button
                        onClick={() => remove(l.id)}
                        aria-label="حذف"
                        className="rounded-[var(--radius-sm)] px-1.5 py-1 text-crit transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-white/5"
                      >
                        🗑
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 ps-6">
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

                  {pinningId === l.id && (
                    <LocationPinPicker
                      initial={null}
                      onConfirm={(lat, lng) => savePin(l.id, lat, lng)}
                      onCancel={() => setPinningId(null)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <PlannerRouteMap stops={routeStops} />
      </div>
    </div>
  );
}
