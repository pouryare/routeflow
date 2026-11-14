"use client";

import { warningText, type OpeningWarning } from "@/lib/openingWarning";

import { tehranTodayIso } from "@/lib/jalali";
import JalaliDateInput from "@/components/meridian/JalaliDateInput";
import { friendlyError } from "@/lib/userMessage";
import { useState } from "react";
import { faNum } from "@/lib/format";
import { Icon } from "@/components/meridian/Icon";
import { useUndoableAction } from "@/components/tapflow/useUndoableAction";

interface Assignment {
  vehicle_key: number;
  stops: { delivery_id: number; sort_order: number; eta_min: number; opening?: OpeningWarning }[];
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

type Result = { ok: boolean; error?: string };
const errorOf = async (res: Response) => ((await res.json().catch(() => ({}))) as { error?: string }).error;

/** The held writes behind «تثبیت» and the freeze button (FB2): they run when the undo window closes. */
async function commitPlan(plan: Plan, setRunIds: (ids: number[]) => void): Promise<Result> {
  const res = await fetch("/api/sales/routing/commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan }),
  });
  if (!res.ok) return { ok: false, error: await errorOf(res) };
  setRunIds(((await res.json()) as { run_ids: number[] }).run_ids);
  return { ok: true };
}

async function freezeRun(runId: number, setRunIds: (f: (ids: number[]) => number[]) => void): Promise<Result> {
  const res = await fetch(`/api/sales/runs/${runId}/freeze`, { method: "POST" });
  if (!res.ok) return { ok: false, error: await errorOf(res) };
  setRunIds((ids) => ids.filter((i) => i !== runId));
  return { ok: true };
}

export default function RoutingPlanner({ vehicleNames }: { vehicleNames: Record<number, string> }) {
  const [date, setDate] = useState(() => tehranTodayIso());
  const [plan, setPlan] = useState<Plan | null>(null);
  const [runIds, setRunIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // FB2: commit and freeze are held for the 5-second undo instead of firing at once.
  const { run: runUndoable, pending } = useUndoableAction();

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
      if (!res.ok) setMsg(friendlyError(j.error, "پیشنهاد مسیر ساخته نشد؛ دوباره تلاش کنید"));
      else setPlan(j.plan);
    } finally {
      setBusy(false);
    }
  }

  function commit() {
    if (!plan) return;
    runUndoable({ message: "مسیرها تثبیت شد", send: () => commitPlan(plan, setRunIds), failure: "مسیرها قطعی نشدند؛ دوباره تلاش کنید" });
  }
  function freeze(runId: number) {
    runUndoable({ message: "مسیر قفل شد", send: () => freezeRun(runId, setRunIds), failure: "مسیر قفل نشد؛ دوباره تلاش کنید" });
  }

  return (
    <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        <JalaliDateInput value={date} onChange={setDate} required aria-label="تاریخ مسیریابی" />
        <button
          type="button"
          disabled={busy || pending}
          onClick={() => void build()}
          className="rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-1)] hover:bg-[var(--surface-secondary)] disabled:opacity-50"
        >
          <Icon name="plus" size="md" />
          ساخت پیشنهاد
        </button>
        {plan && (
          <button
            type="button"
            disabled={busy || pending}
            onClick={commit}
            className="rounded-[var(--radius-md)] bg-[var(--accent)] px-[var(--space-3)] py-[var(--space-1)] text-white disabled:opacity-50"
          >
            <Icon name="pin" size="md" />
            تثبیت
          </button>
        )}
      </div>

      {msg && <p className="m-0 text-[length:var(--text-xs)] text-[var(--danger)]">{msg}</p>}

      {plan && (
        <>
          {plan.source === "greedy" && (
            <p className="m-0 text-[length:var(--text-xs)] text-[var(--warning)]">
              بدون بهینه‌ساز — مسیر تقریبی
            </p>
          )}
          {plan.weather && plan.weather.conditions.length > 0 && (
            <div className="rounded-[var(--radius-md)] border border-[var(--warning)] bg-[var(--surface-secondary)] p-[var(--space-3)] text-[length:var(--text-xs)]">
              <div className="flex flex-wrap gap-[var(--space-2)]">
                {plan.weather.notes_fa.map((note) => (
                  <span key={note} className="text-[var(--foreground)]">
                    <Icon name="weather" size="sm" /> {note}
                  </span>
                ))}
              </div>
              <p className="m-0 mt-[var(--space-1)] text-[var(--muted)]">
                ظرفیت مؤثر: {faNum(plan.weather.effective_max_stops)} از {faNum(plan.weather.base_stops)} توقف
              </p>
              {plan.weather.cold_chain_capped && (
                <p className="m-0 mt-[var(--space-1)] text-[var(--danger)]">
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
                <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
                  {faNum(a.stops.length)} توقف · {faNum(a.distance_km)} کیلومتر · {faNum(a.duration_min)} دقیقه
                </span>
              </div>
              <ol className="m-0 mt-[var(--space-1)] pr-[var(--space-4)] text-[length:var(--text-xs)] text-[var(--muted)]">
                {a.stops.map((s) => (
                  <li key={s.delivery_id}>
                    تحویل {faNum(s.delivery_id)} · حدود {faNum(s.eta_min)} دقیقه
                    {s.opening && <span className="text-[var(--warning)]"> · {warningText(s.opening)}</span>}
                  </li>
                ))}
              </ol>
              {runIds[i] !== undefined && (
                <button
                  type="button"
                  disabled={busy || pending}
                  onClick={() => freeze(runIds[i])}
                  className="mt-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--text-xs)]"
                >
                  <Icon name="check" size="sm" />
                  قطعی‌کردن
                </button>
              )}
            </div>
          ))}
          {plan.unassigned.length > 0 && (
            <p className="m-0 text-[length:var(--text-xs)] text-[var(--danger)]">
              {faNum(plan.unassigned.length)} تحویل جا نشد — ظرفیت خودروها کافی نیست
            </p>
          )}
        </>
      )}
    </div>
  );
}
