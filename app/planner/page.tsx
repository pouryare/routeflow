"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { CustomerRow } from "@/lib/types";
import { nearestNeighborOrder } from "@/lib/geo";
import type { RouteStop } from "@/components/PlannerRouteMap";
import DeliveryImportPanel from "@/components/DeliveryImportPanel";
import { useToast } from "@/components/ToastProvider";

const PlannerRouteMap = dynamic(() => import("@/components/PlannerRouteMap"), { ssr: false });

const WEEKDAYS = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];

interface PlanRow {
  id: number;
  entity_type: "district" | "customer";
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

const STATUS_META: Record<PlanRow["status"], { label: string; color: string }> = {
  planned: { label: "برنامه‌ریزی‌شده", color: "var(--warn)" },
  done: { label: "انجام شد", color: "var(--good)" },
  skipped: { label: "رد شد", color: "var(--neutral)" },
};

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
  const [plansByDate, setPlansByDate] = useState<Record<string, PlanRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [addQuery, setAddQuery] = useState("");
  const [myPos, setMyPos] = useState<{ lat: number; lng: number } | null>(null);
  const toast = useToast();
  const [locating, setLocating] = useState(false);

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

  useEffect(() => {
    loadWeek();
  }, [loadWeek]);

  useEffect(() => {
    fetch("/api/customers")
      .then((r) => r.json())
      .then((d) => setCustomers(d.customers ?? []));
  }, []);

  const dayPlans = (plansByDate[selectedDate] ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);

  const addCandidates = useMemo(() => {
    const q = addQuery.trim();
    if (!q) return [];
    const already = new Set(dayPlans.filter((p) => p.entity_type === "customer").map((p) => p.entity_id));
    return customers
      .filter((c) => !already.has(c.id) && (c.business_name.includes(q) || c.customer_code.includes(q)))
      .slice(0, 6);
  }, [addQuery, customers, dayPlans]);

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
      toast("خطا در افزودن به برنامه", "error");
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
      toast("خطا در تغییر وضعیت", "error");
    } finally {
      loadWeek();
    }
  }

  async function removePlan(id: number) {
    try {
      const res = await fetch(`/api/visit-plans/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast("از برنامه حذف شد.", "info");
    } catch {
      toast("خطا در حذف", "error");
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

  const orderedStops = useMemo(() => {
    const stops = dayPlans.filter(
      (p) => p.status === "planned" && p.entity_type === "customer" && p.lat && p.lng
    ) as (PlanRow & { lat: number; lng: number })[];
    if (stops.length === 0) return [];
    return nearestNeighborOrder(stops, myPos);
  }, [dayPlans, myPos]);

  const routeUrl = useMemo(() => {
    if (orderedStops.length === 0) return null;
    const destStop = orderedStops[orderedStops.length - 1];
    const routeStops = myPos ? orderedStops : orderedStops.slice(1);
    const originParam = myPos ? `${myPos.lat},${myPos.lng}` : `${orderedStops[0].lat},${orderedStops[0].lng}`;
    const waypointStops = routeStops.slice(0, -1);

    const params = new URLSearchParams({
      api: "1",
      origin: originParam,
      destination: `${destStop.lat},${destStop.lng}`,
      travelmode: "driving",
    });
    if (waypointStops.length) {
      params.set("waypoints", waypointStops.map((s) => `${s.lat},${s.lng}`).join("|"));
    }
    return `https://www.google.com/maps/dir/?${params.toString()}`;
  }, [orderedStops, myPos]);

  const routeStops = useMemo<RouteStop[]>(() => {
    if (orderedStops.length === 0) return [];
    const stops: RouteStop[] = [];
    if (myPos) stops.push({ lat: myPos.lat, lng: myPos.lng, label: "موقعیت من" });
    orderedStops.forEach((s) => stops.push({ lat: s.lat, lng: s.lng, label: s.label }));
    return stops;
  }, [orderedStops, myPos]);

  return (
    <div dir="rtl" className="min-h-screen bg-bg p-4 sm:p-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-mono text-[length:var(--text-xs)] uppercase tracking-[0.12em] text-accent">
              Route Planner
            </div>
            <h1 className="text-[length:var(--text-xl)] font-bold text-text">برنامه‌ریزی مسیر و پوشش</h1>
          </div>
          <Link
            href="/"
            className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-[length:var(--text-sm)] text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent hover:text-accent"
          >
            بازگشت به نقشه ←
          </Link>
        </div>

        <div className="flex gap-1 overflow-x-auto rounded-[var(--radius-md)] border border-border bg-surface p-1">
          {days.map((d) => {
            const ds = toDateStr(d);
            const active = ds === selectedDate;
            const count = (plansByDate[ds] ?? []).length;
            return (
              <button
                key={ds}
                onClick={() => setSelectedDate(ds)}
                className={`flex shrink-0 flex-col items-center gap-0.5 rounded-[var(--radius-sm)] px-3 py-2 text-[length:var(--text-sm)] transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] ${
                  active ? "bg-accent font-medium text-[#04191c]" : "text-text-muted hover:bg-white/5 hover:text-text"
                }`}
              >
                <span>{dayLabel(d)}</span>
                <span className="font-mono text-[length:var(--text-xs)] opacity-80">{dateLabel(d)}</span>
                {count > 0 && (
                  <span
                    className={`mt-0.5 rounded-full px-1.5 text-[length:var(--text-xs)] font-mono ${
                      active ? "bg-[#04191c]/20 text-[#04191c]" : "bg-white/10 text-text-faint"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <DeliveryImportPanel selectedDate={selectedDate} onAdded={loadWeek} />

        <section className="rounded-[var(--radius-lg)] border border-border bg-surface-raised p-4">
          <h2 className="mb-2 font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-muted">
            افزودن مشتری به برنامه
          </h2>
          <div className="relative">
            <input
              value={addQuery}
              onChange={(e) => setAddQuery(e.target.value)}
              placeholder="نام یا کد مشتری…"
              className="w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-[length:var(--text-sm)] text-text outline-none transition-[border-color] duration-[var(--dur-base)] ease-[var(--ease-out)] placeholder:text-text-faint focus:border-accent"
            />
            {addCandidates.length > 0 && (
              <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface-raised elevate-accent">
                {addCandidates.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => addToPlan(c.id)}
                    className="flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2 text-right text-[length:var(--text-sm)] text-text last:border-b-0 hover:bg-white/5"
                  >
                    <span className="truncate">{c.business_name}</span>
                    <span className="shrink-0 font-mono text-[length:var(--text-xs)] text-text-faint">{c.customer_code}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-[var(--radius-lg)] border border-border bg-surface-raised p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-muted">
              برنامه {dayLabel(new Date(selectedDate))} ({dayPlans.length})
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
                  شروع مسیر بهینه ↗
                </a>
              )}
            </div>
          </div>

          {loading ? (
            <p className="text-[length:var(--text-sm)] text-text-muted">در حال بارگذاری…</p>
          ) : dayPlans.length === 0 ? (
            <p className="text-[length:var(--text-sm)] text-text-faint">برای این روز هنوز چیزی برنامه‌ریزی نشده.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {dayPlans.map((p, i) => (
                <li
                  key={p.id}
                  className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2"
                >
                  <div className="flex flex-col gap-0.5">
                    <button
                      onClick={() => move(p.id, -1)}
                      disabled={i === 0}
                      aria-label="بالا"
                      className="text-text-faint hover:text-text disabled:opacity-30"
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => move(p.id, 1)}
                      disabled={i === dayPlans.length - 1}
                      aria-label="پایین"
                      className="text-text-faint hover:text-text disabled:opacity-30"
                    >
                      ▼
                    </button>
                  </div>
                  <div className="flex-1 truncate text-[length:var(--text-sm)] text-text">
                    {p.entity_type === "district" ? "🗺 " : ""}
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
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={() => setStatus(p.id, "done")}
                      aria-label="انجام شد"
                      className="rounded-[var(--radius-sm)] px-1.5 py-1 text-good transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-white/5"
                    >
                      ✓
                    </button>
                    <button
                      onClick={() => setStatus(p.id, "skipped")}
                      aria-label="رد شد"
                      className="rounded-[var(--radius-sm)] px-1.5 py-1 text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-white/5"
                    >
                      ✗
                    </button>
                    <button
                      onClick={() => removePlan(p.id)}
                      aria-label="حذف"
                      className="rounded-[var(--radius-sm)] px-1.5 py-1 text-crit transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-white/5"
                    >
                      🗑
                    </button>
                  </div>
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
