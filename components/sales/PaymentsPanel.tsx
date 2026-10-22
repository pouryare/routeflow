"use client";

import { tehranTodayIso, faJalaliDateTime } from "@/lib/jalali";
import { useRunAfterMount } from "@/lib/useRunAfterMount";
import { friendlyError } from "@/lib/userMessage";
import FilterChips from "@/components/mobile/FilterChips";
import { PERIODS, PERIOD_LABEL, periodRange, type Period } from "@/lib/periods";
import { Icon } from "@/components/meridian/Icon";
import SectionHead from "@/components/meridian/SectionHead";
import JalaliDateInput from "@/components/meridian/JalaliDateInput";
import { Fragment, useCallback, useMemo, useState } from "react";
import { faToman } from "@/lib/format";
import PaymentFlow from "@/components/flows/PaymentFlow";
import { autoOpenFlow, currentSearch } from "@/lib/flows/autoOpen";
import { isToman, toToman } from "@/lib/money";
import { METHOD_LABEL, filterPayments, groupByMonth, paymentTotals, paymentsCsv, type AllocationDraft, type Customer, type OpenOrder, type Payment } from "@/lib/paymentsView";

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
  const [receivedAt, setReceivedAt] = useState(() => tehranTodayIso());
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /* The tap flow remounts per opening (the key) so each recording starts on its first
     question; `open` only slides the sheet in and out. */
  const [flow, setFlow] = useState(() => autoOpenFlow("new", currentSearch()));

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
  const [period, setPeriod] = useState<Period | "">("");
  /* A period chip sets the same from/to the date fields used to; tapping the chosen one again clears it. */
  function choosePeriod(p: Period | "") {
    setPeriod(p);
    const r = p === "" ? { from: "", to: "" } : periodRange(p, tehranTodayIso());
    setFFrom(r.from);
    setFTo(r.to);
    setPage(0);
  }
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<AllocationDraft[]>([]);
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);
  const [allocError, setAllocError] = useState<string | null>(null);

  /* A voided payment's money is GONE, so it is counted nowhere in the totals. Counting it
     and calling the result "collected this month" is the most misleading number this screen
     could print. */
  const live = useMemo(() => (payments ?? []).filter((p) => !p.voided_at), [payments]);

  const filtered = useMemo(
    () => filterPayments(payments ?? [], { method: fMethod, from: fFrom, to: fTo, voided: fVoided }),
    [payments, fMethod, fFrom, fTo, fVoided]
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  /* Today / week / month, by method — from the same `live` list the table shows, so a
     figure on a card and a row in the table can never disagree. */
  const totals = useMemo(() => {
    const now = new Date();
    return paymentTotals(live, tehranTodayIso(now), tehranTodayIso(new Date(now.getTime() - 7 * 864e5)));
  }, [live]);

  /* Jalali month sections. A flat list of 400 receipts is unreadable; grouped by month it is
     a story. The grouping is derived at render, never stored. */
  const months = useMemo(() => groupByMonth(pageRows), [pageRows]);

  const exportCsv = useCallback(() => {
    const blob = new Blob([paymentsCsv(filtered, customerName)], { type: "text/csv;charset=utf-8;" });
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
    const body = await res.json().catch(() => null);
    setPayments(res.ok && body ? body.payments : []);
  }, []);

  useRunAfterMount(load);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // toToman reads Persian and Arabic digits and refuses anything that is not a number; the
    // old strip-everything-but-digits rewrite turned "1000.5" into 10005 and "-5" into 5.
    const amt = toToman(amount);
    if (!customerId || amt === null || amt <= 0) {
      setError("مشتری و مبلغ لازم است");
      return;
    }
    if (/[.٫]/.test(amount)) {
      setError("مبلغ را به تومان و بدون اعشار وارد کنید");
      return;
    }
    if (!isToman(amt)) {
      setError("مبلغ بیش از حد مجاز است");
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

  /* Voiding is asked on the row, in an in-app form, not a browser prompt: the wording matters.
     This no longer "deletes" a receipt. It posts a reversing journal, so the receipt stays in
     the ledger forever with a red line through it. A user who believes they are deleting will
     be surprised by the audit trail later, and a user who does not understand the reversal may
     hesitate to use the feature at all. So the form says what is about to happen, in both
     halves: the money goes, and the row stays. */
  const [voiding, setVoiding] = useState<{ id: number; reason: string } | null>(null);

  async function voidPayment(id: number, reason: string) {
    const res = await fetch(`/api/payments/${id}?action=void`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (res.ok) {
      setVoiding(null);
      void load();
    } else setError(friendlyError((await res.json().catch(() => null))?.error, "دریافت ابطال نشد؛ دوباره تلاش کنید"));
  }

  return (
    <div dir="rtl" className="mx-auto flex max-w-3xl flex-col gap-6 p-4">
      <h1 className="text-lg font-bold text-text">دریافت وجه</h1>

      {/* On a phone the form is replaced by the tap flow; the full form stays from md up,
          where backdating a receipt or typing a note is comfortable. */}
      <button
        type="button"
        onClick={() => setFlow((f) => ({ key: f.key + 1, open: true }))}
        className="inline-flex items-center justify-center gap-[var(--space-2)] rounded bg-accent px-4 py-3 text-base font-medium text-accent-ink md:hidden"
      >
        <Icon name="plus" size="md" />
        ثبت دریافت جدید
      </button>

      <form onSubmit={submit} className="hidden flex-col gap-3 rounded-lg border border-border bg-surface p-4 md:flex">
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
        <FilterChips
          groups={[
            {
              id: "period",
              label: "بازه",
              mode: "single",
              options: PERIODS.filter((x) => x !== "all" && x !== "custom").map((x) => ({ id: x, label: PERIOD_LABEL[x] })),
              value: period,
              onChange: (v) => { choosePeriod(v as Period); },
            },
            {
              id: "method",
              label: "روش",
              mode: "single",
              options: Object.entries(METHOD_LABEL).map(([k, v]) => ({ id: k, label: v })),
              value: fMethod,
              onChange: (v) => { setFMethod(v as string); setPage(0); },
            },
            {
              id: "voided",
              label: "باطال‌شده‌ها",
              mode: "single",
              neutral: "hide",
              options: [{ id: "only", label: "فقط باطال‌شده‌ها" }, { id: "all", label: "همه با باطال‌شده‌ها" }],
              value: fVoided,
              sheet: true,
              onChange: (v) => { setFVoided(v as "hide" | "only" | "all"); setPage(0); },
            },
          ]}
        />
        <div className="flex flex-wrap items-end gap-2 text-sm">
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
                      <Fragment key={p.id}>
                      <tr className="border-b border-border last:border-0">
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
                                onClick={() => setVoiding({ id: p.id, reason: "" })}
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
                      {voiding?.id === p.id && (
                        <tr className="border-b border-border last:border-0">
                          <td colSpan={5} className="p-2">
                            <div className="flex flex-col gap-2 rounded border border-border p-2">
                              <p className="m-0 text-xs text-text-muted">
                                این کار دریافت را حذف نمی‌کند: یک سند معکوس در دفتر ثبت می‌شود و ردیف اصلی خط‌خورده باقی می‌ماند.
                              </p>
                              <label className="flex flex-col gap-1 text-xs text-text-muted">دلیل ابطال دریافت<input
                                className="rounded border border-border bg-bg p-2 text-sm w-full"
                                placeholder="دلیل ابطال را بنویسید"
                                value={voiding.reason}
                                onChange={(e) => setVoiding({ ...voiding, reason: e.target.value })}
                              /></label>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  disabled={!voiding.reason.trim()}
                                  onClick={() => void voidPayment(p.id, voiding.reason.trim())}
                                  className="rounded border border-danger px-3 py-1 text-xs text-danger disabled:opacity-50"
                                >
                                  <Icon name="undo" size="sm" />
                                  ابطال دریافت و ثبت سند معکوس
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setVoiding(null)}
                                  className="rounded border border-border px-3 py-1 text-xs"
                                >
                                  <Icon name="x" size="sm" />
                                  انصراف از ابطال
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                      </Fragment>
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
      {flow.key > 0 && (
        <PaymentFlow
          key={flow.key}
          open={flow.open}
          customers={customers}
          customerId={customerId ? Number(customerId) : undefined}
          onRecorded={() => void load()}
          onClose={() => setFlow((f) => ({ ...f, open: false }))}
          onReopen={() => setFlow((f) => ({ ...f, open: true }))}
        />
      )}
    </div>
  );
}
