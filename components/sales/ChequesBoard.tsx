"use client";

import { isToman, toToman } from "@/lib/money";
import { tehranTodayIso, faJalaliDate } from "@/lib/jalali";
import { useRunAfterMount } from "@/lib/useRunAfterMount";
import { friendlyError } from "@/lib/userMessage";
import { Icon } from "@/components/meridian/Icon";
import JalaliDateInput from "@/components/meridian/JalaliDateInput";
import { useCallback, useMemo, useState } from "react";
import { faToman } from "@/lib/format";
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
    const amt = toToman(form.amount_toman);
    if (/[.٫]/.test(form.amount_toman)) {
      setError("مبلغ را به تومان و بدون اعشار وارد کنید");
      return;
    }
    if (amt !== null && !isToman(amt)) {
      setError("مبلغ بیش از حد مجاز است");
      return;
    }
    if (!form.customer_id || amt === null || amt <= 0 || !form.cheque_no) {
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

  /** The replacement cheque being entered on one card. It is a form on the card, not a
   *  browser prompt: a prompt cannot show the Shamsi date picker, so it asked for an ISO date
   *  to be typed by hand. */
  const [replacing, setReplacing] = useState<{ id: number; cheque_no: string; due_date: string } | null>(null);

  async function advance(id: number, to: ChequeStatus, replacement?: { cheque_no: string; due_date: string }) {
    if (to === "replaced" && !replacement) {
      setReplacing({ id, cheque_no: "", due_date: today });
      return;
    }
    const res = await fetch(`/api/cheques/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "advance", to, replacement }),
    });
    if (res.ok) {
      setReplacing(null);
      void load();
    } else setError(friendlyError((await res.json().catch(() => null))?.error, "تغییر وضعیت چک انجام نشد؛ دوباره تلاش کنید"));
  }

  const byStatus = (s: ChequeStatus) => (cheques ?? []).filter((c) => c.status === s);

  return (
    <div dir="rtl" className="mx-auto flex max-w-5xl flex-col gap-6 p-4">
      <h1 className="text-lg font-bold text-text">چک‌ها</h1>

      <form onSubmit={record} className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface p-4 md:grid-cols-3">
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
        <label className="flex flex-col gap-1 text-xs text-text-muted">مبلغ (تومان)<input
          className="rounded border border-border bg-bg p-2 text-left font-mono text-sm w-full"
         
          inputMode="numeric"
          value={form.amount_toman}
          onChange={(e) => setForm((f) => ({ ...f, amount_toman: e.target.value }))}
        /></label>
        <label className="flex flex-col gap-1 text-xs text-text-muted">شمارهٔ چک<input
          className="rounded border border-border bg-bg p-2 text-sm w-full"
         
          value={form.cheque_no}
          onChange={(e) => setForm((f) => ({ ...f, cheque_no: e.target.value }))}
        /></label>
        <label className="flex flex-col gap-1 text-xs text-text-muted">بانک<input
          className="rounded border border-border bg-bg p-2 text-sm w-full"
         
          value={form.bank_name}
          onChange={(e) => setForm((f) => ({ ...f, bank_name: e.target.value }))}
        /></label>
        <label className="col-span-2 flex items-center gap-2 text-xs text-text-muted md:col-span-1">
          سررسید
          <JalaliDateInput value={form.due_date} onChange={(iso) => setForm((f) => ({ ...f, due_date: iso }))} aria-label="تاریخ سررسید" />
        </label>
        <button type="submit" className="col-span-2 inline-flex items-center justify-center gap-[var(--space-2)] rounded bg-accent px-4 py-2 text-sm text-white md:col-span-1">
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
                        {`تغییر وضعیت به «${CHEQUE_STATUS_LABEL[to]}»`}
                      </button>
                    ))}
                  </div>
                  {replacing?.id === c.id && (
                    <div className="mt-2 flex flex-col gap-2 rounded border border-border p-2">
                      <label className="flex flex-col gap-1 text-xs text-text-muted">شمارهٔ چک جایگزین<input
                        className="rounded border border-border bg-bg p-2 text-left font-mono text-sm w-full"
                       
                        value={replacing.cheque_no}
                        onChange={(e) => setReplacing({ ...replacing, cheque_no: e.target.value })}
                      /></label>
                      <label className="flex items-center gap-1 text-xs text-text-muted">
                        سررسید چک جایگزین
                        <JalaliDateInput
                          value={replacing.due_date}
                          onChange={(iso) => setReplacing({ ...replacing, due_date: iso })}
                          aria-label="سررسید چک جایگزین"
                        />
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={!replacing.cheque_no.trim() || !replacing.due_date}
                          onClick={() => void advance(c.id, "replaced", { cheque_no: replacing.cheque_no.trim(), due_date: replacing.due_date })}
                          className="rounded bg-accent px-3 py-1 text-xs text-white disabled:opacity-50"
                        >
                          <Icon name="check" size="sm" />
                          ثبت چک جایگزین
                        </button>
                        <button
                          type="button"
                          onClick={() => setReplacing(null)}
                          className="rounded border border-border px-3 py-1 text-xs"
                        >
                          <Icon name="x" size="sm" />
                          انصراف از جایگزینی چک
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
