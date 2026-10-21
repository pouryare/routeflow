"use client";

import { PAYMENT_STATUS_LABEL } from "@/lib/orderStateMachine";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { faNum } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import type { PipelineOrder } from "./OrderPipeline";
import Avatar from "@/components/meridian/Avatar";
import { Icon } from "@/components/meridian/Icon";


const PAYMENT_LABEL = PAYMENT_STATUS_LABEL as Record<string, string>;

/** Opened by tapping a pipeline card — the artifact's `.modal`.
 *
 *  The artifact's amount control is a slider. Here it is a READ-ONLY track, and that is
 *  deliberate rather than unfinished: the only place this system records money changing
 *  hands is the driver's stop at the door (lib/delivery.ts), which writes the collection
 *  and the order's status in one transaction, and the commission ledger reads that same
 *  column. A slider on this screen would need a second write path to `paid_toman` that
 *  skips the stop — so a figure dragged here would move somebody's pay with no delivery
 *  behind it. The shape is the artifact's; the pretence is gone, and the note says so.
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
    /* Focus moves into the dialog so the keyboard is not left on the board behind it. */
    sheet.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [order, onClose]);

  const pct =
    order && order.total_toman > 0
      ? Math.max(0, Math.min(100, (order.paid_toman / order.total_toman) * 100))
      : 0;

  return (
    <>
      <div
        className={`meridian-scrim${order ? " on" : ""}`}
        onClick={onClose}
        aria-hidden
      />
      <div
        className={`modal${order ? " on" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pr-title"
        aria-hidden={!order}
        tabIndex={-1}
        ref={sheet}
      >
        {order && (
          <>
            <div className="mhead">
              <div>
                <h2 id="pr-title">پردازش سفارش</h2>
                <div className="s">
                  {order.customer_name} · {faNum(Number(order.order_no.split("-")[1] ?? 0))}#
                </div>
              </div>
              <button className="inline-flex items-center justify-center gap-[var(--space-2)] x x--labelled" type="button" aria-label="بستن پردازش سفارش" onClick={onClose}>
                <Icon name="x" size="sm" />
                <span>بستن پردازش</span>
              </button>
            </div>

            <div className="mbody">
              <div className="field">
                <label>ثبت‌کننده</label>
                <div className="ro">
                  {order.salesperson_name ?? "—"} · {faJalaliDate(order.order_date)}
                </div>
              </div>

              <div className="field">
                <label>مسئول تحویل</label>
                <div className="people">
                  {/* Read-only chips: who a delivery belongs to is set on the route, not
                      here, and a chip that looked pressable but changed nothing would be
                      worse than one that plainly reports. */}
                  <span className="person" aria-pressed={true}>
                    <Avatar name={order.salesperson_name ?? "؟"} size={24} />
                    {order.salesperson_name ?? "بدون فروشنده"}
                  </span>
                </div>
              </div>

              <div className="field">
                <label>مبلغ دریافتی</label>
                <div className="slidewrap">
                  <div className="sliderow">
                    <span className="big mono">{faNum(order.paid_toman)}</span>
                    <span className="of">
                      از <span className="mono">{faNum(order.total_toman)}</span> تومان ·{" "}
                      {PAYMENT_LABEL[order.payment_status] ?? "نامشخص"}
                    </span>
                  </div>
                  <div
                    role="meter"
                    aria-valuemin={0}
                    aria-valuemax={order.total_toman}
                    aria-valuenow={order.paid_toman}
                    aria-label="مبلغ وصول‌شده"
                    style={{
                      height: 8,
                      borderRadius: 999,
                      background: `linear-gradient(to left, var(--accent) 0 ${pct}%, var(--sunk) ${pct}% 100%)`,
                    }}
                  />
                  <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--muted)" }}>
                    وصول وجه هنگام تحویل و توسط راننده ثبت می‌شود؛ اینجا فقط خوانده می‌شود.
                  </p>
                </div>
              </div>
            </div>

            <div className="mfoot">
              <Link className="btn ghost" href={`/sales/orders/${order.id}`}>
                صفحهٔ سفارش
              </Link>
              {onConfirm && (
                <button className="inline-flex items-center justify-center gap-[var(--space-2)] btn solid" type="button" onClick={onConfirm} disabled={busy}>
                  <Icon name="check" size="md" />
                  {busy ? "…" : "تأیید و قیمت‌گذاری"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
