"use client";

import { useEffect, useRef } from "react";
import { faToman, faNum } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import { Avatar } from "@/components/AvatarStack";
import type { PipelineOrder } from "./OrderPipeline";

const PAYMENT_LABEL: Record<string, string> = {
  unpaid: "پرداخت‌نشده",
  partial: "بخشی",
  paid: "تسویه‌شده",
};

/** Opened by tapping a pipeline card (MASTER.md, "Processing modal").
 *
 *  The collected-against-total track is a METER here, not a slider, and deliberately:
 *  the only place this system records money changing hands is the driver's stop at the
 *  door (lib/delivery.ts), which writes the collection and the order status in one
 *  transaction. A slider on this screen would need a second write path to `paid_toman`
 *  that skips the stop, and the commission ledger reads that column -- so a figure typed
 *  here would move somebody's pay without a delivery behind it. The track keeps the
 *  shape and drops the pretence; see the note under the figure.
 */
export default function ProcessingModal({
  order,
  onClose,
  onConfirm,
  busy = false,
}: {
  order: PipelineOrder | null;
  onClose: () => void;
  /** Present only when this order can still be confirmed. */
  onConfirm?: () => void;
  busy?: boolean;
}) {
  const sheet = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!order) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    /* Focus moves into the sheet so the keyboard is not left behind on the board
       underneath, which is still in the tab order behind the veil. */
    sheet.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [order, onClose]);

  if (!order) return null;

  const paidPct =
    order.total_toman > 0
      ? Math.max(0, Math.min(100, (order.paid_toman / order.total_toman) * 100))
      : 0;

  return (
    <div
      className="proc"
      /* The veil closes; the sheet does not. Without the target check every click inside
         the sheet bubbles up here and shuts it. */
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="proc__sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="proc-title"
        tabIndex={-1}
        ref={sheet}
      >
        <div className="flex items-start justify-between gap-[var(--space-3)]">
          <div className="min-w-0">
            <p className="m-0 text-[length:var(--text-xs)] text-[var(--text-muted)]">
              سفارش {faNum(Number(order.order_no.split("-")[1] ?? 0))}#
            </p>
            <h2
              id="proc-title"
              className="m-0 mt-[var(--space-1)] text-[length:var(--text-lg)] font-semibold text-[var(--text)]"
            >
              {order.customer_name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="بستن"
            className="rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            ✕
          </button>
        </div>

        <div className="mt-[var(--space-4)] flex items-center gap-[var(--space-2)]">
          <Avatar name={order.salesperson_name ?? "بدون فروشنده"} size={34} />
          <span className="text-[length:var(--text-sm)] text-[var(--text-muted)]">
            فروشندهٔ این سفارش
            <strong className="mx-[var(--space-1)] font-medium text-[var(--text)]">
              {order.salesperson_name ?? "—"}
            </strong>
          </span>
        </div>

        <dl className="proc__grid mt-[var(--space-4)]">
          <div className="proc__cell">
            <dt>تاریخ سفارش</dt>
            <dd className="num">{faJalaliDate(order.order_date)}</dd>
          </div>
          <div className="proc__cell">
            <dt>مبلغ کل</dt>
            <dd className="num">{faToman(order.total_toman)}</dd>
          </div>
          <div className="proc__cell">
            <dt>وزن</dt>
            <dd className="num">{faNum(order.kg)} کیلو</dd>
          </div>
          <div className="proc__cell">
            <dt>اقلام</dt>
            <dd className="num">{faNum(order.line_count)}</dd>
          </div>
        </dl>

        <section className="mt-[var(--space-4)]">
          <div className="flex items-baseline justify-between gap-[var(--space-2)]">
            <h3 className="m-0 text-[length:var(--text-sm)] font-medium text-[var(--text)]">
              وصول‌شده از مبلغ کل
            </h3>
            <span className="num text-[length:var(--text-sm)] text-[var(--text-muted)]">
              {faToman(order.paid_toman)} · {PAYMENT_LABEL[order.payment_status] ?? order.payment_status}
            </span>
          </div>
          <div
            className="paytrack mt-[var(--space-2)]"
            style={{ ["--pay" as string]: `${paidPct}%` }}
            role="meter"
            aria-valuemin={0}
            aria-valuemax={order.total_toman}
            aria-valuenow={order.paid_toman}
            aria-label="مبلغ وصول‌شده"
          />
          <p className="m-0 mt-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
            وصول وجه هنگام تحویل و توسط راننده ثبت می‌شود؛ اینجا فقط خوانده می‌شود.
          </p>
        </section>

        <div className="mt-[var(--space-5)] flex flex-wrap items-center justify-end gap-[var(--space-2)]">
          <a
            href={`/sales/orders/${order.id}`}
            className="rounded-[var(--radius-pill)] border border-[var(--border)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--text-muted)] no-underline hover:border-[var(--border-strong)] hover:text-[var(--text)]"
          >
            صفحهٔ سفارش
          </a>
          {onConfirm && (
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className="rounded-[var(--radius-pill)] border border-[var(--accent)] bg-[var(--accent)] px-[var(--space-5)] py-[var(--space-2)] text-[length:var(--text-sm)] font-medium text-[var(--accent-ink)] disabled:opacity-50"
            >
              {busy ? "…" : "تأیید و قیمت‌گذاری"}
            </button>
          )}
        </div>
        {onConfirm && (
          <p className="m-0 mt-[var(--space-2)] text-end text-[length:var(--text-xs)] text-[var(--text-muted)]">
            بعد از تأیید، اقلام و قیمت‌ها قابل ویرایش نیستند.
          </p>
        )}
      </div>
    </div>
  );
}
