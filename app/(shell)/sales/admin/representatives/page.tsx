"use client";

import { useCallback, useEffect, useState } from "react";

import { REP_STAGE_TRANSITIONS, REP_STAGE_LABEL, type RepStage } from "@/lib/repStages";
import { Icon } from "@/components/meridian/Icon";
import { faJalaliDateTime } from "@/lib/jalali";

interface RepRow {
  id: number;
  rep_code: string;
  business_name: string;
  customer_code: string;
  stage: RepStage;
  manager_user_id: number | null;
  created_at: string;
}

interface OnboardingStep {
  id: number;
  step_code: string;
  label_fa: string;
  required: number;
  sort_order: number;
  completed_at: string | null;
}

interface WholesaleCustomer {
  id: number;
  business_name: string;
  customer_code: string;
}

export default function AdminRepresentativesPage() {
  const [reps, setReps] = useState<RepRow[] | null>(null);
  const [candidates, setCandidates] = useState<WholesaleCustomer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [repCode, setRepCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [openId, setOpenId] = useState<number | null>(null);
  const [steps, setSteps] = useState<OnboardingStep[]>([]);
  const [openRep, setOpenRep] = useState<RepRow | null>(null);

  const load = useCallback(async () => {
    const [rRes, cRes] = await Promise.all([
      fetch("/api/admin/representatives"),
      fetch("/api/admin/representatives?candidates=1"),
    ]);
    setReps((await rRes.json()).representatives ?? []);
    setCandidates((await cRes.json()).candidates ?? []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const openDrawer = useCallback(async (rep: RepRow) => {
    setOpenId(rep.id);
    setOpenRep(rep);
    const res = await fetch(`/api/admin/representatives/${rep.id}`);
    const data = await res.json();
    setSteps(data.onboarding ?? []);
    setOpenRep(data.representative ?? rep);
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId || !repCode.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/representatives", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customer_id: Number(customerId), rep_code: repCode.trim() }),
    });
    setBusy(false);
    if (res.ok) {
      setCustomerId("");
      setRepCode("");
      await load();
    } else {
      setError((await res.json().catch(() => null))?.error ?? "ثبت نماینده انجام نشد");
    }
  }

  async function patch(repId: number, body: object) {
    const res = await fetch(`/api/admin/representatives/${repId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => null))?.error ?? "انجام نشد");
      return;
    }
    setError(null);
    await load();
    const one = await fetch(`/api/admin/representatives/${repId}`).then((r) => r.json());
    setSteps(one.onboarding ?? []);
    setOpenRep(one.representative ?? null);
  }

  return (
    <>
    <div className="flex flex-col gap-[var(--space-5)]">
      <h1 className="m-0 text-[length:var(--text-lg)]">نمایندگان</h1>

      <form onSubmit={create} className="card flex flex-wrap items-end gap-3 p-4">
        <label className="flex flex-col gap-1 text-[length:var(--text-xs)] text-text-muted">
          مشتری عمده‌فروش
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className="rounded-[var(--radius-sm)] border border-border bg-surface px-2 py-1 text-text"
          >
            <option value="">انتخاب کنید…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.business_name} ({c.customer_code})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[length:var(--text-xs)] text-text-muted">
          کد نماینده
          <input
            value={repCode}
            onChange={(e) => setRepCode(e.target.value)}
            className="rounded-[var(--radius-sm)] border border-border bg-surface px-2 py-1 font-mono text-text"
          />
        </label>
        <button
          type="submit"
          disabled={busy || !customerId || !repCode.trim()}
          className="rounded-[var(--radius-sm)] border border-accent px-3 py-1 text-accent transition-colors hover:bg-accent hover:text-accent-ink disabled:opacity-50"
        >
          افزودن نماینده
        </button>
        {error && <span className="text-[length:var(--text-xs)] text-[var(--crit)]">{error}</span>}
      </form>

      <table className="w-full border-collapse text-[length:var(--text-sm)]">
        <thead>
          <tr className="text-right text-text-muted">
            <th className="px-3 py-2">کد</th>
            <th className="px-3 py-2">کسب‌وکار</th>
            <th className="px-3 py-2">مرحله</th>
            <th className="px-3 py-2">ایجاد</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {reps?.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td className="px-3 py-2 font-mono text-text-faint">{r.rep_code}</td>
              <td className="px-3 py-2 text-text">{r.business_name}</td>
              <td className="px-3 py-2 text-text-muted">{REP_STAGE_LABEL[r.stage]}</td>
              <td className="px-3 py-2 text-text-muted">{faJalaliDateTime(r.created_at)}</td>
              <td className="px-3 py-2 text-left">
                <button onClick={() => openDrawer(r)} className="text-accent hover:underline">
                  پذیرش و مرحله
                </button>
              </td>
            </tr>
          ))}
          {reps && reps.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-center text-text-muted">
                هنوز نماینده‌ای ثبت نشده است.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {openId !== null && openRep && (
        <div className="card flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <strong>
              {openRep.business_name} — {REP_STAGE_LABEL[openRep.stage]}
            </strong>
            <button onClick={() => setOpenId(null)} className="text-text-muted hover:text-text">
              بستن
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[length:var(--text-xs)] text-text-muted">تغییر مرحله:</span>
            <select
              value=""
              onChange={(e) => {
                const to = e.target.value as RepStage;
                if (to) void patch(openRep.id, { action: "advance", stage: to });
              }}
              disabled={REP_STAGE_TRANSITIONS[openRep.stage].length === 0}
              className="rounded-[var(--radius-sm)] border border-border bg-surface px-2 py-1 text-[length:var(--text-xs)]"
            >
              <option value="">—</option>
              {REP_STAGE_TRANSITIONS[openRep.stage].map((s) => (
                <option key={s} value={s}>
                  {REP_STAGE_LABEL[s]}
                </option>
              ))}
            </select>
          </div>

          <ul className="flex flex-col gap-1">
            {steps.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-[length:var(--text-sm)]">
                <span className={s.completed_at ? "text-[var(--good)]" : "text-text-muted"}>
                  <Icon name={s.completed_at ? "check" : "dot"} size="sm" />
                </span>
                <span className={s.completed_at ? "text-text-muted line-through" : "text-text"}>
                  {s.label_fa}
                  {!s.required && <span className="mr-1 text-text-faint"> (اختیاری)</span>}
                </span>
                {!s.completed_at && (
                  <button
                    onClick={() => patch(openRep.id, { action: "complete_step", step_code: s.step_code })}
                    className="mr-auto text-[length:var(--text-xs)] text-accent hover:underline"
                  >
                    تکمیل
                  </button>
                )}
                {s.completed_at && (
                  <span className="mr-auto text-[length:var(--text-xs)] text-text-faint">
                    {faJalaliDateTime(s.completed_at)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>    </>
  );
}
