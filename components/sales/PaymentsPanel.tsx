"use client";

import JalaliDateInput from "@/components/meridian/JalaliDateInput";
import { useCallback, useEffect, useMemo, useState } from "react";
import { faToman } from "@/lib/format";
import { faJalaliDateTime } from "@/lib/jalali";

const METHOD_LABEL: Record<string, string> = {
  CASH: "نقد",
  POS: "کارت‌خوان",
  CARD_TO_CARD: "کارت به کارت",
  CHEQUE: "چک",
  CREDIT_NOTE: "بستانکاری",
  OTHER: "سایر",
};

interface Customer {
  id: number;
  business_name: string;
  customer_code: string;
}

interface Payment {
  id: number;
  customer_id: number;
  amount_toman: number;
  method: string;
  received_at: string;
  reference: string | null;
  note: string | null;
  voided_at: string | null;
}

export default function PaymentsPanel({ customers }: { customers: Customer[] }) {
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [customerId, setCustomerId] = useState(() => {
    if (typeof window === "undefined") return "";
    const q = new URLSearchParams(window.location.search).get("customer_id");
    return q && /^\d+$/.test(q) ? q : "";
  });
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [receivedAt, setReceivedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const customerName = useMemo(() => {
    const m = new Map(customers.map((c) => [c.id, c.business_name]));
    return (id: number) => m.get(id) ?? "—";
  }, [customers]);

  const load = useCallback(async () => {
    const res = await fetch("/api/payments");
    const body = await res.json();
    setPayments(res.ok ? body.payments : []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const amt = Number(amount.replace(/[^\d]/g, ""));
    if (!customerId || !Number.isInteger(amt) || amt <= 0) {
      setError("مشتری و مبلغ لازم است");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_id: Number(customerId),
        amount_toman: amt,
        method,
        received_at: receivedAt,
        reference: reference || null,
        note: note || null,
      }),
    });
    setBusy(false);
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(body?.error ?? "ثبت نشد");
      return;
    }
    setAmount("");
    setReference("");
    setNote("");
    void load();
  }

  async function voidPayment(id: number) {
    const reason = window.prompt("دلیل ابطال؟");
    if (!reason) return;
    const res = await fetch(`/api/payments/${id}?action=void`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (res.ok) void load();
    else setError((await res.json().catch(() => null))?.error ?? "ابطال نشد");
  }

  return (
    <div dir="rtl" className="mx-auto flex max-w-3xl flex-col gap-6 p-4">
      <h1 className="text-lg font-bold text-text">دریافت وجه</h1>

      <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <label className="flex flex-col gap-1 text-sm">
          مشتری
          <select
            className="rounded border border-border bg-bg p-2"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          >
            <option value="">— انتخاب —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.business_name} ({c.customer_code})
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            مبلغ (تومان)
            <input
              className="rounded border border-border bg-bg p-2 text-left font-mono"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            روش
            <select
              className="rounded border border-border bg-bg p-2"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              {Object.entries(METHOD_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            تاریخ
            <JalaliDateInput value={receivedAt} onChange={setReceivedAt} required aria-label="تاریخ دریافت" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            شمارهٔ پیگیری / کارت‌خوان
            <input
              className="rounded border border-border bg-bg p-2"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          یادداشت
          <input className="rounded border border-border bg-bg p-2" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>

        <p className="text-xs text-text-muted">
          مبلغ به‌صورت خودکار روی قدیمی‌ترین سفارش‌های تسویه‌نشده تخصیص می‌یابد؛ باقی‌مانده به حساب مشتری می‌نشیند.
        </p>

        {error && <p className="text-sm text-danger">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          ثبت دریافت
        </button>
      </form>

      <div className="flex flex-col gap-2">
        <h2 className="sechead__title">دریافت‌های اخیر</h2>
        {payments === null ? (
          <p className="text-sm text-text-muted">در حال بارگذاری…</p>
        ) : payments.length === 0 ? (
          <p className="text-sm text-text-muted">دریافتی ثبت نشده است.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-text-faint">
              <tr>
                <th className="p-2 text-right">مشتری</th>
                <th className="p-2 text-right">مبلغ</th>
                <th className="p-2 text-right">روش</th>
                <th className="p-2 text-right">تاریخ</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className="p-2">{customerName(p.customer_id)}</td>
                  <td className={`p-2 text-left font-mono ${p.voided_at ? "line-through opacity-50" : ""}`}>
                    {faToman(p.amount_toman)}
                  </td>
                  <td className="p-2">{METHOD_LABEL[p.method] ?? p.method}</td>
                  <td className="p-2">{faJalaliDateTime(p.received_at)}</td>
                  <td className="p-2 text-left">
                    {p.voided_at ? (
                      <span className="text-xs text-text-faint">باطل شد</span>
                    ) : (
                      <button className="text-xs text-danger" onClick={() => voidPayment(p.id)}>
                        ابطال
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
