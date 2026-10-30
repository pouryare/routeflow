"use client";

import { FieldInput } from "@/components/FieldInput";
import SmartPicker from "@/components/mobile/SmartPicker";
import KeypadField from "@/components/mobile/KeypadField";
import { tehranTodayIso, faJalaliDate, faJalaliDateTime } from "@/lib/jalali";
import { useRunAfterMount } from "@/lib/useRunAfterMount";
import { friendlyError } from "@/lib/userMessage";
import { Icon } from "@/components/meridian/Icon";
import JalaliDateInput from "@/components/meridian/JalaliDateInput";
import { Fragment, useCallback, useMemo, useState } from "react";
import { faNum } from "@/lib/format";
import { BATCH_STATUS_LABEL, BATCH_TRANSITIONS, type BatchStatus } from "@/lib/batchStates";

interface Product {
  id: number;
  name: string;
  base_unit: string;
}

interface Batch {
  id: number;
  product_id: number;
  batch_code: string;
  supplier_batch_ref: string | null;
  expiry_date: string | null;
  status: BatchStatus;
  on_hand: number;
}

interface TraceDelivery {
  order_no: string;
  customer_name: string;
  base_qty: number;
  delivered_at: string | null;
}

const MANUAL_MOVES: BatchStatus[] = ["active", "quarantined", "recalled"];

export default function BatchesPanel({ products }: { products: Product[] }) {
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [traceFor, setTraceFor] = useState<number | null>(null);
  /* The batch whose «فراخوان» button has been pressed once: that row's buttons turn into the
     question (no dialog, nothing moves), and only «بله» sends. */
  const [recallArmed, setRecallArmed] = useState<number | null>(null);
  const [trace, setTrace] = useState<TraceDelivery[] | null>(null);
  const [form, setForm] = useState({
    product_id: "",
    batch_code: "",
    supplier_batch_ref: "",
    produced_at: "",
    expiry_date: "",
    qty_received_base: "",
  });

  const productName = useMemo(() => {
    const m = new Map(products.map((p) => [p.id, p.name]));
    return (id: number) => m.get(id) ?? "—";
  }, [products]);

  const load = useCallback(async () => {
    const res = await fetch("/api/sales/batches");
    const body = await res.json().catch(() => null);
    setBatches(res.ok ? body.batches : []);
  }, []);

  useRunAfterMount(load);

  const today = tehranTodayIso();

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const qty = Number(form.qty_received_base.replace(/[^\d.]/g, ""));
    if (!form.product_id || !(qty > 0)) {
      setError("کالا و مقدار دریافتی لازم است");
      return;
    }
    const res = await fetch("/api/sales/batches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product_id: Number(form.product_id),
        batch_code: form.batch_code || null,
        supplier_batch_ref: form.supplier_batch_ref || null,
        produced_at: form.produced_at || null,
        expiry_date: form.expiry_date || null,
        qty_received_base: qty,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(friendlyError(body?.error, "سری ساخت ثبت نشد؛ دوباره تلاش کنید"));
      return;
    }
    setForm((f) => ({ ...f, batch_code: "", supplier_batch_ref: "", qty_received_base: "" }));
    void load();
  }

  async function setStatus(id: number, to: BatchStatus) {
    // A recall raises a reminder for every customer who received the lot, and recalled is a dead end
    // (it can only go to depleted), so its button asks first (recallArmed); quarantine is reversible
    // and does not.
    setRecallArmed(null);
    const res = await fetch(`/api/sales/batches/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "status", to }),
    });
    if (res.ok) void load();
    else setError(friendlyError((await res.json().catch(() => null))?.error, "تغییر وضعیت سری ساخت انجام نشد؛ دوباره تلاش کنید"));
  }

  async function openTrace(id: number) {
    if (traceFor === id) {
      setTraceFor(null);
      setTrace(null);
      return;
    }
    setTraceFor(id);
    setTrace(null);
    const res = await fetch(`/api/sales/batches/${id}/trace`);
    const body = await res.json().catch(() => null);
    setTrace(res.ok ? body.deliveries : []);
  }

  return (
    <div dir="rtl" className="mx-auto flex max-w-4xl flex-col gap-6 p-4">
      <h1 className="text-lg font-bold text-text">سری‌های ساخت</h1>

      <form onSubmit={create} className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface p-4 md:grid-cols-3">
        <SmartPicker
          scope="batch-products"
          label="کالا"
          items={products.map((p) => ({ id: String(p.id), label: p.name }))}
          value={form.product_id}
          onChange={(id) => setForm((f) => ({ ...f, product_id: id }))}
        />
        <label className="flex flex-col gap-1 text-xs text-text-muted">کد سری ساخت<FieldInput className="w-full" placeholder="خودکار اگر خالی" value={form.batch_code} onChange={(e) => setForm((f) => ({ ...f, batch_code: e.target.value }))} /></label>
        <div className="flex flex-col gap-1 text-xs text-text-muted">مقدار دریافتی<KeypadField label="مقدار دریافتی" value={form.qty_received_base} onChange={(v) => setForm((f) => ({ ...f, qty_received_base: v }))} decimal /></div>
        <label className="flex flex-col gap-1 text-xs text-text-muted">مرجع سری ساخت تأمین‌کننده<FieldInput className="w-full" value={form.supplier_batch_ref} onChange={(e) => setForm((f) => ({ ...f, supplier_batch_ref: e.target.value }))} /></label>
        <label className="flex items-center gap-1 text-xs text-text-muted">
          تولید
          <JalaliDateInput value={form.produced_at} onChange={(iso) => setForm((f) => ({ ...f, produced_at: iso }))} aria-label="تاریخ تولید" />
        </label>
        <label className="flex items-center gap-1 text-xs text-text-muted">
          انقضا
          <JalaliDateInput value={form.expiry_date} onChange={(iso) => setForm((f) => ({ ...f, expiry_date: iso }))} aria-label="تاریخ انقضا" />
        </label>
        <button type="submit" className="inline-flex items-center justify-center gap-[var(--space-2)] rounded bg-accent px-4 py-2 text-sm text-white">
          <Icon name="plus" size="md" />
          ثبت سری ساخت
        </button>
        {error && <p className="col-span-full text-sm text-danger">{error}</p>}
      </form>

      {batches === null ? (
        <p className="text-sm text-text-muted">در حال بارگذاری…</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-text-faint">
            <tr>
              <th className="p-2 text-right">کالا</th>
              <th className="p-2 text-right">کد</th>
              <th className="p-2 text-right">انقضا</th>
              <th className="p-2 text-right">موجودی</th>
              <th className="p-2 text-right">وضعیت</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => {
              const overdue = b.expiry_date && b.expiry_date < today;
              return (
                <Fragment key={b.id}>
                  <tr className="border-b border-border last:border-0">
                    <td className="p-2">{productName(b.product_id)}</td>
                    <td className="p-2 font-mono text-xs">{b.batch_code}</td>
                    <td className={`p-2 ${overdue ? "text-danger" : ""}`}>
                      {b.expiry_date ? faJalaliDate(b.expiry_date) : "—"}
                    </td>
                    <td className={`p-2 text-left font-mono ${b.on_hand < 0 ? "text-danger" : ""}`}>{faNum(b.on_hand)}</td>
                    <td className="p-2">{BATCH_STATUS_LABEL[b.status]}</td>
                    <td className="p-2 text-left">
                      {recallArmed === b.id ? (
                        <div className="flex flex-wrap items-center justify-end gap-1" role="group" aria-label="تأیید فراخوان">
                          <span className="text-xs text-danger">برای همهٔ مشتریانی که این سری را گرفته‌اند یادآور ثبت می‌شود و برگشت‌پذیر نیست.</span>
                          <button onClick={() => setStatus(b.id, "recalled")} className="rounded border border-danger px-2 py-0.5 touch text-xs text-danger">
                            <Icon name="check" size="md" />
                            بله، فراخوان شود
                          </button>
                          <button onClick={() => setRecallArmed(null)} className="rounded border border-border px-2 py-0.5 touch text-xs hover:border-accent">
                            <Icon name="x" size="md" />
                            انصراف
                          </button>
                        </div>
                      ) : (
                      <div className="flex flex-wrap justify-end gap-1">
                        {(BATCH_TRANSITIONS[b.status] ?? [])
                          .filter((t) => MANUAL_MOVES.includes(t))
                          .map((t) => (
                            <button key={t} onClick={() => (t === "recalled" ? setRecallArmed(b.id) : setStatus(b.id, t))} className="rounded border border-border px-2 py-0.5 touch text-xs hover:border-accent">
                              <Icon name="package" size="md" />
                              {BATCH_STATUS_LABEL[t]}
                            </button>
                          ))}
                        <button onClick={() => openTrace(b.id)} className="rounded border border-border px-2 py-0.5 touch text-xs hover:border-accent">
                          <Icon name="route" size="md" />
                          ردیابی
                        </button>
                      </div>
                      )}
                    </td>
                  </tr>
                  {traceFor === b.id && (
                    <tr className="bg-bg">
                      <td colSpan={6} className="p-2 text-xs">
                        {trace === null ? (
                          "…"
                        ) : trace.length === 0 ? (
                          "این سری ساخت هنوز به مشتری تحویل نشده است."
                        ) : (
                          <ul className="flex flex-col gap-1">
                            {trace.map((d, i) => (
                              <li key={i}>
                                {d.customer_name} — سفارش {d.order_no} — {faNum(d.base_qty)} واحد
                                {d.delivered_at ? ` — ${faJalaliDateTime(d.delivered_at)}` : ""}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
