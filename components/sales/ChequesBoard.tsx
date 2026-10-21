"use client";

import { tehranTodayIso, faJalaliDate } from "@/lib/jalali";
import { useRunAfterMount } from "@/lib/useRunAfterMount";
import { friendlyError } from "@/lib/userMessage";
import { Icon } from "@/components/meridian/Icon";
import JalaliDateInput from "@/components/meridian/JalaliDateInput";
import { useCallback, useMemo, useState } from "react";
import { faToman } from "@/lib/format";
import PaymentFlow from "@/components/flows/PaymentFlow";
import { CHEQUE_STATUS_LABEL, CHEQUE_TRANSITIONS, type ChequeStatus } from "@/lib/chequeStates";

interface Customer {
  id: number;
  business_name: string;
  customer_code: string;
}

interface Cheque {
  id: number;
  customer_id: number;
  amount_toman: number;
  cheque_no: string;
  bank_name: string | null;
  due_date: string;
  status: ChequeStatus;
}

const COLUMNS: ChequeStatus[] = ["in_hand", "deposited", "bounced"];

export default function ChequesBoard({ customers }: { customers: Customer[] }) {
  const [cheques, setCheques] = useState<Cheque[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* Phone entry is the tap flow, remounted per opening; the form below stays from md up. */
  const [flow, setFlow] = useState({ key: 0, open: false });
  const [form, setForm] = useState({
    customer_id: "",
    amount_toman: "",
    cheque_no: "",
    bank_name: "",
    due_date: tehranTodayIso(),
    received_at: tehranTodayIso(),
  });

  const customerName = useMemo(() => {
    const m = new Map(customers.map((c) => [c.id, c.business_name]));
    return (id: number) => m.get(id) ?? "—";
  }, [customers]);

  const load = useCallback(async () => {
    const res = await fetch("/api/cheques");
    const body = await res.json().catch(() => null);
    setCheques(res.ok ? body.cheques : []);
  }, []);

  useRunAfterMount(load);

  const today = tehranTodayIso();

  async function record(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const amt = Number(form.amount_toman.replace(/[^\d]/g, ""));
    if (!form.customer_id || !Number.isInteger(amt) || amt <= 0 || !form.cheque_no) {
      setError("مشتری، مبلغ و شمارهٔ چک لازم است");
      return;
    }
    const res = await fetch("/api/cheques", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_id: Number(form.customer_id),
        amount_toman: amt,
        cheque_no: form.cheque_no,
        bank_name: form.bank_name || null,
        due_date: form.due_date,
        received_at: form.received_at,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(friendlyError(body?.error, "چک ثبت نشد؛ دوباره تلاش کنید"));
      return;
    }
    setForm((f) => ({ ...f, amount_toman: "", cheque_no: "", bank_name: "" }));
    void load();
  }

  async function advance(id: number, to: ChequeStatus) {
    let replacement: unknown;
    if (to === "replaced") {
      const cheque_no = window.prompt("شمارهٔ چک جایگزین؟");
      if (!cheque_no) return;
      const due_date = window.prompt("سررسید چک جایگزین (YYYY-MM-DD)؟", today) ?? today;
      replacement = { cheque_no, due_date };
    }
    const res = await fetch(`/api/cheques/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "advance", to, replacement }),
    });
    if (res.ok) void load();
    else setError(friendlyError((await res.json().catch(() => null))?.error, "تغییر وضعیت چک انجام نشد؛ دوباره تلاش کنید"));
  }

  const byStatus = (s: ChequeStatus) => (cheques ?? []).filter((c) => c.status === s);

  return (
    <div dir="rtl" className="mx-auto flex max-w-5xl flex-col gap-6 p-4">
      <h1 className="text-lg font-bold text-text">چک‌ها</h1>

      <button
        type="button"
        onClick={() => setFlow((f) => ({ key: f.key + 1, open: true }))}
        className="inline-flex items-center justify-center gap-[var(--space-2)] rounded bg-accent px-4 py-3 text-base font-medium text-accent-ink md:hidden"
      >
        <Icon name="plus" size="md" />
        ثبت چک جدید
      </button>

      <form onSubmit={record} className="hidden gap-3 rounded-lg border border-border bg-surface p-4 md:grid md:grid-cols-3">
        <select
          className="rounded border border-border bg-bg p-2 text-sm"
          value={form.customer_id}
          onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))}
        >
          <option value="">— مشتری —</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.business_name}
            </option>
          ))}
        </select>
        <input
          className="rounded border border-border bg-bg p-2 text-left font-mono text-sm"
          placeholder="مبلغ (تومان)"
          inputMode="numeric"
          value={form.amount_toman}
          onChange={(e) => setForm((f) => ({ ...f, amount_toman: e.target.value }))}
        />
        <input
          className="rounded border border-border bg-bg p-2 text-sm"
          placeholder="شمارهٔ چک"
          value={form.cheque_no}
          onChange={(e) => setForm((f) => ({ ...f, cheque_no: e.target.value }))}
        />
        <input
          className="rounded border border-border bg-bg p-2 text-sm"
          placeholder="بانک"
          value={form.bank_name}
          onChange={(e) => setForm((f) => ({ ...f, bank_name: e.target.value }))}
        />
        <label className="flex items-center gap-2 text-xs text-text-muted">
          سررسید
          <JalaliDateInput value={form.due_date} onChange={(iso) => setForm((f) => ({ ...f, due_date: iso }))} aria-label="تاریخ سررسید" />
        </label>
        <button type="submit" className="inline-flex items-center justify-center gap-[var(--space-2)] rounded bg-accent px-4 py-2 text-sm text-white">
          <Icon name="check" size="md" />
          ثبت چک
        </button>
        {error && <p className="col-span-full text-sm text-danger">{error}</p>}
      </form>

      <div className="grid gap-4 md:grid-cols-3">
        {COLUMNS.map((col) => (
          <div key={col} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
            <h2 className="sechead__title">
              {CHEQUE_STATUS_LABEL[col]} ({byStatus(col).length})
            </h2>
            {byStatus(col).map((c) => {
              const overdue = col === "in_hand" && c.due_date < today;
              return (
                <div key={c.id} className="rounded border border-border bg-bg p-2 text-sm">
                  <div className="flex justify-between">
                    <span>{customerName(c.customer_id)}</span>
                    <span className="font-mono">{faToman(c.amount_toman)}</span>
                  </div>
                  <div className="text-xs text-text-faint">
                    چک {c.cheque_no} · سررسید {faJalaliDate(c.due_date)}
                    {overdue && <span className="mr-1 text-danger"> (گذشته)</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {CHEQUE_TRANSITIONS[c.status].map((to) => (
                      <button
                        key={to}
                        onClick={() => advance(c.id, to)}
                        className="rounded border border-border px-2 py-0.5 text-xs hover:border-accent"
                      >
                        <Icon name="wallet" size="md" />
                        {CHEQUE_STATUS_LABEL[to]}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {flow.key > 0 && (
        <PaymentFlow
          key={flow.key}
          open={flow.open}
          customers={customers}
          method="CHEQUE"
          onRecorded={() => void load()}
          onClose={() => setFlow((f) => ({ ...f, open: false }))}
          onReopen={() => setFlow((f) => ({ ...f, open: true }))}
        />
      )}
    </div>
  );
}
