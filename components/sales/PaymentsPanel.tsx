"use client";

import { useRunAfterMount } from "@/lib/useRunAfterMount";
import { friendlyError } from "@/lib/userMessage";
import { Icon } from "@/components/meridian/Icon";
import SectionHead from "@/components/meridian/SectionHead";
import JalaliDateInput from "@/components/meridian/JalaliDateInput";
import { useCallback, useMemo, useState } from "react";
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
  void_reason?: string | null;
}

interface OpenOrder {
  id: number;
  total_toman: number;
  paid_toman: number;
  order_date: string;
}

interface AllocationDraft {
  order_id: number | null;
  amount_toman: number;
}

const PAGE_SIZE = 25;

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

  /* Filters, page and the allocation editor are separate pieces of state rather than one
     blob, so clearing one does not reset the others. */
  const [fMethod, setFMethod] = useState("");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [fVoided, setFVoided] = useState<"hide" | "only" | "all">("hide");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<AllocationDraft[]>([]);
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);
  const [allocError, setAllocError] = useState<string | null>(null);

  /* A voided payment's money is GONE, so it is counted nowhere in the totals. Counting it
     and calling the result "collected this month" is the most misleading number this screen
     could print. */
  const live = useMemo(() => (payments ?? []).filter((p) => !p.voided_at), [payments]);

  const filtered = useMemo(() => {
    const day = (iso: string) => iso.slice(0, 10);
    const rows = (payments ?? []).filter((p) => {
      if (fVoided === "hide" && p.voided_at) return false;
      if (fVoided === "only" && !p.voided_at) return false;
      if (fMethod && p.method !== fMethod) return false;
      if (fFrom && day(p.received_at) < fFrom) return false;
      if (fTo && day(p.received_at) > fTo) return false;
      return true;
    });
    return rows.sort((a, b) => (a.received_at < b.received_at ? 1 : -1));
  }, [payments, fMethod, fFrom, fTo, fVoided]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  /* Today / week / month, by method — from the same `live` list the table shows, so a
     figure on a card and a row in the table can never disagree. */
  const totals = useMemo(() => {
    const now = new Date();
    const todayISO = now.toISOString().slice(0, 10);
    const weekAgo = new Date(now.getTime() - 7 * 864e5).toISOString().slice(0, 10);
    const monthStart = todayISO.slice(0, 8) + "01";
    const window = (from: string) => live.filter((p) => p.received_at.slice(0, 10) >= from);
    const today = live.filter((p) => p.received_at.slice(0, 10) === todayISO);
    const build = (rows: Payment[]) => {
      const m = new Map<string, number>();
      for (const p of rows) m.set(p.method, (m.get(p.method) ?? 0) + p.amount_toman);
      return {
        total: rows.reduce((s, p) => s + p.amount_toman, 0),
        byMethod: [...m.entries()].sort((a, b) => b[1] - a[1]),
      };
    };
    return {
      today: build(today),
      week: build(window(weekAgo)),
      month: build(window(monthStart)),
    };
  }, [live]);

  /* Jalali month sections. A flat list of 400 receipts is unreadable; grouped by month it is
     a story. The grouping is derived at render, never stored. */
  const months = useMemo(() => {
    const m = new Map<string, Payment[]>();
    for (const p of pageRows) {
      const key = p.received_at.slice(0, 7);
      const arr = m.get(key);
      if (arr) arr.push(p);
      else m.set(key, [p]);
    }
    return [...m.entries()];
  }, [pageRows]);

  const exportCsv = useCallback(() => {
    const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const head = ["تاریخ", "مشتری", "مبلغ", "روش", "پیگیری", "یادداشت", "وضعیت"];
    const rows = filtered.map((p) =>
      [
        p.received_at.slice(0, 10),
        customerName(p.customer_id),
        String(p.amount_toman),
        METHOD_LABEL[p.method] ?? p.method,
        p.reference ?? "",
        p.note ?? "",
        p.voided_at ? "ابطال‌شده" : "فعال",
      ]
        .map(esc)
        .join(",")
    );
    /* A BOM, because Excel on Windows reads a bare UTF-8 CSV as Latin-1 and turns every
       Persian word into mojibake — a spreadsheet whose row labels are all wrong. */
    const blob = new Blob(["﻿" + [head.map(esc).join(","), ...rows].join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "payments.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }, [filtered, customerName]);

  async function openAllocation(paymentId: number) {
    setAllocError(null);
    const res = await fetch(`/api/payments/${paymentId}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setAllocError(friendlyError(body?.error, "تخصیص‌ها بارگذاری نشد؛ دوباره تلاش کنید"));
      return;
    }
    setOpenOrders(body.openOrders ?? []);
    setDraft((body.allocations ?? []).map((a: AllocationDraft) => ({ ...a })));
    setEditing(paymentId);
  }

  async function saveAllocation() {
    if (editing === null) return;
    setAllocError(null);
    const res = await fetch(`/api/payments/${editing}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allocations: draft.filter((d) => d.amount_toman > 0) }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setAllocError(friendlyError(body?.error, "تخصیص ذخیره نشد؛ دوباره تلاش کنید"));
      return;
    }
    setEditing(null);
    setDraft([]);
  }

  const load = useCallback(async () => {
    const res = await fetch("/api/payments");
    const body = await res.json();
    setPayments(res.ok ? body.payments : []);
  }, []);

  useRunAfterMount(load);

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
      setError(friendlyError(body?.error, "دریافت ثبت نشد؛ دوباره تلاش کنید"));
      return;
    }
    setAmount("");
    setReference("");
    setNote("");
    void load();
  }

  async function voidPayment(id: number) {
    /* The wording matters: this no longer "deletes" a receipt. Task 4 made it post a
       reversing journal, so the receipt stays in the ledger forever with a red line
       through it. A user who believes they are deleting will be surprised by the audit
       trail later, and a user who does not understand the reversal may hesitate to use
       the feature at all. So say what is about to happen, in both halves: the money goes,
       and the row stays. */
    const reason = window.prompt(
      "ابطال این دریافت\n\n" +
        "این کار دریافت را حذف نمی‌کند: یک سند معکوس در دفتر ثبت می‌شود و ردیف اصلی خط‌خورده باقی می‌ماند.\n" +
        "دلیل ابطال را بنویسید:"
    );
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
          className="inline-flex items-center justify-center gap-[var(--space-2)] rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          <Icon name="check" size="md" />
          ثبت دریافت
        </button>
      </form>

      <div className="flex flex-col gap-3">
        <h2 className="sechead__title">خلاصهٔ دریافتی‌ها</h2>
        {/* Voided receipts are excluded from every figure here: the money was given back,
            so counting it would be the most misleading number this screen could print. */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {([
            ["امروز", totals.today],
            ["۷ روز گذشته", totals.week],
            ["این ماه", totals.month],
          ] as const).map(([label, t]) => (
            <div key={label} className="rounded border border-border bg-surface p-2 text-sm">
              <div className="text-xs text-text-muted">{label}</div>
              <div className="font-mono text-lg">{faToman(t.total)}</div>
              <ul className="mt-1 flex flex-col gap-0.5 text-xs text-text-muted">
                {t.byMethod.length === 0 ? (
                  <li>—</li>
                ) : (
                  t.byMethod.map(([m, v]) => (
                    <li key={m} className="flex justify-between gap-2">
                      <span>{METHOD_LABEL[m] ?? m}</span>
                      <span className="font-mono">{faToman(v)}</span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          ))}
        </div>

        <h2 className="sechead__title">دریافت‌ها</h2>
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <label className="flex flex-col gap-1">
            روش
            <select
              className="rounded border border-border bg-bg p-1"
              value={fMethod}
              onChange={(e) => { setFMethod(e.target.value); setPage(0); }}
              aria-label="فیلتر روش"
            >
              <option value="">همه</option>
              {Object.entries(METHOD_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            از
            <JalaliDateInput value={fFrom}
              onChange={(v) => { setFFrom(v); setPage(0); }}
              aria-label="از تاریخ" className="rounded border border-border bg-bg p-1" />
          </label>
          <label className="flex flex-col gap-1">
            تا
            <JalaliDateInput value={fTo}
              onChange={(v) => { setFTo(v); setPage(0); }}
              aria-label="تا تاریخ" className="rounded border border-border bg-bg p-1" />
          </label>
          <label className="flex flex-col gap-1">
            باطال‌شده‌ها
            <select
              className="rounded border border-border bg-bg p-1"
              value={fVoided}
              onChange={(e) => { setFVoided(e.target.value as "hide" | "only" | "all"); setPage(0); }}
              aria-label="نمایش باطال‌شده‌ها"
            >
              <option value="hide">پنهان</option>
              <option value="only">فقط باطال‌شده‌ها</option>
              <option value="all">همه</option>
            </select>
          </label>
          <button type="button" className="rounded border border-border px-2 py-1 text-xs"
            onClick={exportCsv}>
            <Icon name="download" size="sm" />
            خروجی CSV
          </button>
          <span className="ms-auto text-xs text-text-muted">
            {filtered.length.toLocaleString("fa-IR")} ردیف
          </span>
        </div>

        {payments === null ? (
          <p className="text-sm text-text-muted">در حال بارگذاری…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-text-muted">دریافتی با این فیلترها یافت نشد.</p>
        ) : (
          <>
            {months.map(([key, rows]) => (
              <section key={key} className="flex flex-col gap-1">
                <SectionHead title={key} as="h3" />
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
                    {rows.map((p) => (
                      <tr key={p.id} className="border-b border-border last:border-0">
                        <td className="p-2">{customerName(p.customer_id)}</td>
                        <td
                          className={`p-2 text-left font-mono ${p.voided_at ? "line-through opacity-50" : ""}`}
                        >
                          {faToman(p.amount_toman)}
                          {p.voided_at ? (
                            <span className="ms-2 text-xs text-danger">
                              ابطال‌شده{p.void_reason ? ` — ${p.void_reason}` : ""}
                            </span>
                          ) : null}
                        </td>
                        <td className="p-2">{METHOD_LABEL[p.method] ?? p.method}</td>
                        <td className="p-2">{faJalaliDateTime(p.received_at)}</td>
                        <td className="p-2 text-left">
                          {p.voided_at ? null : (
                            <span className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                className="text-xs text-text-muted hover:text-accent"
                                onClick={() => voidPayment(p.id)}
                              >
                                <Icon name="undo" size="sm" />
                                ابطال + ثبت معکوس
                              </button>
                              <button
                                type="button"
                                className="text-xs text-text-muted hover:text-accent"
                                onClick={() => openAllocation(p.id)}
                              >
                                <Icon name="link" size="sm" />
                                تخصیص
                              </button>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}

            {pageCount > 1 ? (
              <div className="flex items-center justify-end gap-2 text-xs">
                <button
                  type="button"
                  className="rounded border border-border px-2 py-1 disabled:opacity-40"
                  disabled={safePage === 0}
                  onClick={() => setPage(safePage - 1)}
                >
                  <Icon name="chevron-right" size="sm" />
                  صفحهٔ قبل
                </button>
                <span className="tnum">
                  {safePage + 1} / {pageCount}
                </span>
                <button
                  type="button"
                  className="rounded border border-border px-2 py-1 disabled:opacity-40"
                  disabled={safePage >= pageCount - 1}
                  onClick={() => setPage(safePage + 1)}
                >
                  صفحهٔ بعد
                  <Icon name="chevron-left" size="sm" />
                </button>
              </div>
            ) : null}
          </>
        )}

        {editing !== null ? (
          <div
            role="dialog"
            aria-label="ویرایش تخصیص"
            className="flex flex-col gap-2 rounded border border-border bg-surface p-3 text-sm"
          >
            <SectionHead title="تخصیص این دریافت" as="h3" />
            <p className="text-xs text-text-muted">
              پیش‌فرض روی قدیمی‌ترین سفارش‌ها می‌نشیند و باقی‌مانده به حساب مشتری. اینجا می‌توانید
              دستی عوضش کنید؛ پول جابه‌جا نمی‌شود، فقط نسبتش با سفارش‌ها.
            </p>
            {openOrders.map((o) => {
              const outstanding = Math.max(0, o.total_toman - o.paid_toman);
              return (
                <label key={o.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="tnum">
                    سفارش {o.id} — مانده {faToman(outstanding)}
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={
                      draft.find((d) => d.order_id === o.id)?.amount_toman ?? 0
                    }
                    onChange={(e) => {
                      const v = Number(e.target.value.replace(/[^\d]/g, ""));
                      setDraft((prev) => {
                        const rest = prev.filter((d) => d.order_id !== o.id);
                        return [...rest, { order_id: o.id, amount_toman: v }];
                      });
                    }}
                    className="w-28 rounded border border-border bg-bg p-1 text-left font-mono"
                  />
                </label>
              );
            })}
            {/* order_id NULL is on-account credit. It is an explicit field rather than a
                silent remainder, because "what is left" is a number someone will ask about. */}
            <label className="flex items-center justify-between gap-2 text-xs">
              <span>باقی‌مانده روی حساب مشتری</span>
              <input
                type="number"
                min={0}
                step={1000}
                value={draft.find((d) => d.order_id === null)?.amount_toman ?? 0}
                onChange={(e) => {
                  const v = Number(e.target.value.replace(/[^\d]/g, ""));
                  setDraft((prev) => [
                    ...prev.filter((d) => d.order_id !== null),
                    { order_id: null, amount_toman: v },
                  ]);
                }}
                className="w-28 rounded border border-border bg-bg p-1 text-left font-mono"
              />
            </label>
            <p className="text-xs text-text-muted">
              جمع تخصیص:{" "}
              <span className="font-mono">
                {faToman(
                  draft.reduce((s, d) => s + (Number.isFinite(d.amount_toman) ? d.amount_toman : 0), 0)
                )}
              </span>{" "}
              از{" "}
              <span className="font-mono">
                {faToman(payments?.find((p) => p.id === editing)?.amount_toman ?? 0)}
              </span>
            </p>
            {allocError ? <p className="text-xs text-danger">{allocError}</p> : null}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={saveAllocation}
                className="rounded bg-accent px-3 py-1 text-xs text-white"
              >
                <Icon name="check" size="sm" />
                ذخیرهٔ تخصیص
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setAllocError(null);
                }}
                className="rounded border border-border px-3 py-1 text-xs"
              >
                <Icon name="x" size="sm" />
                انصراف از ویرایش تخصیص
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
