"use client";

import { useState } from "react";
import { faNum } from "@/lib/format";
import { Icon } from "@/components/meridian/Icon";

interface Assignment {
  vehicle_key: number;
  stops: { delivery_id: number; sort_order: number; eta_min: number }[];
  distance_km: number;
  duration_min: number;
}
interface WeatherBlock {
  conditions: string[];
  notes_fa: string[];
  cold_chain_capped: boolean;
  effective_max_stops: number;
  base_stops: number;
}
interface Plan {
  assignments: Assignment[];
  unassigned: number[];
  source: "vroom" | "greedy";
  date: string;
  weather?: WeatherBlock;
}

export default function RoutingPlanner({ vehicleNames }: { vehicleNames: Record<number, string> }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [plan, setPlan] = useState<Plan | null>(null);
  const [runIds, setRunIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function build() {
    setBusy(true);
    setMsg(null);
    setRunIds([]);
    try {
      const res = await fetch("/api/sales/routing/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      });
      const j = await res.json();
      if (!res.ok) setMsg(j.error ?? "ساخت پیشنهاد ناموفق بود");
      else setPlan(j.plan);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!plan) return;
    setBusy(true);
    try {
      const res = await fetch("/api/sales/routing/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const j = await res.json();
      if (res.ok) setRunIds(j.run_ids);
      else setMsg(j.error ?? "تثبیت ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function freeze(runId: number) {
    setBusy(true);
    try {
      await fetch(`/api/sales/runs/${runId}/freeze`, { method: "POST" });
      setRunIds((ids) => ids.filter((i) => i !== runId));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-2)] py-[var(--space-1)]"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void build()}
          className="rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-1)] hover:bg-[var(--surface-2)] disabled:opacity-50"
        >
          ساخت پیشنهاد
        </button>
        {plan && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void commit()}
            className="rounded-[var(--radius-md)] bg-[var(--accent)] px-[var(--space-3)] py-[var(--space-1)] text-white disabled:opacity-50"
          >
            تثبیت
          </button>
        )}
      </div>

      {msg && <p className="m-0 text-[length:var(--text-xs)] text-[var(--crit)]">{msg}</p>}

      {plan && (
        <>
          {plan.source === "greedy" && (
            <p className="m-0 text-[length:var(--text-xs)] text-[var(--warn)]">
              بدون بهینه‌ساز — مسیر تقریبی
            </p>
          )}
          {plan.weather && plan.weather.conditions.length > 0 && (
            <div className="rounded-[var(--radius-md)] border border-[var(--warn)] bg-[var(--surface-2)] p-[var(--space-3)] text-[length:var(--text-xs)]">
              <div className="flex flex-wrap gap-[var(--space-2)]">
                {plan.weather.notes_fa.map((note) => (
                  <span key={note} className="text-[var(--text)]">
                    <Icon name="weather" size="sm" /> {note}
                  </span>
                ))}
              </div>
              <p className="m-0 mt-[var(--space-1)] text-[var(--text-muted)]">
                ظرفیت مؤثر: {faNum(plan.weather.effective_max_stops)} از {faNum(plan.weather.base_stops)} توقف
              </p>
              {plan.weather.cold_chain_capped && (
                <p className="m-0 mt-[var(--space-1)] text-[var(--crit)]">
                  زنجیرهٔ سرد — زمان مسیر برای خودروی بدون یخچال محدود شده است
                </p>
              )}
            </div>
          )}
          {plan.assignments.map((a, i) => (
            <div
              key={a.vehicle_key ?? i}
              className="rounded-[var(--radius-md)] border border-[var(--border)] p-[var(--space-3)]"
            >
              <div className="flex items-baseline justify-between">
                <strong>{vehicleNames[a.vehicle_key] ?? `خودرو ${faNum(a.vehicle_key)}`}</strong>
                <span className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
                  {faNum(a.stops.length)} توقف · {faNum(a.distance_km)} کیلومتر · {faNum(a.duration_min)} دقیقه
                </span>
              </div>
              <ol className="m-0 mt-[var(--space-1)] pr-[var(--space-4)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
                {a.stops.map((s) => (
                  <li key={s.delivery_id}>
                    تحویل {faNum(s.delivery_id)} · حدود {faNum(s.eta_min)} دقیقه
                  </li>
                ))}
              </ol>
              {runIds[i] !== undefined && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void freeze(runIds[i])}
                  className="mt-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--text-xs)]"
                >
                  قطعی‌کردن
                </button>
              )}
            </div>
          ))}
          {plan.unassigned.length > 0 && (
            <p className="m-0 text-[length:var(--text-xs)] text-[var(--crit)]">
              {faNum(plan.unassigned.length)} تحویل جا نشد — ظرفیت خودروها کافی نیست
            </p>
          )}
        </>
      )}
    </div>
  );
}
