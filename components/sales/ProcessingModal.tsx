"use client";

import { PAYMENT_STATUS_LABEL } from "@/lib/orderStateMachine";
import Link from "next/link";
import { faNum } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import type { PipelineOrder } from "./OrderPipeline";
import Avatar from "@/components/meridian/Avatar";
import { Icon } from "@/components/meridian/Icon";
import BottomSheet from "@/components/mobile/BottomSheet";


const PAYMENT_LABEL = PAYMENT_STATUS_LABEL as Record<string, string>;

/** Opened by tapping a pipeline card: a bottom sheet (BottomSheet) on every screen size.
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
  const pct =
    order && order.total_toman > 0
      ? Math.max(0, Math.min(100, (order.paid_toman / order.total_toman) * 100))
      : 0;

  return (
    <BottomSheet
      open={order !== null}
      title="پردازش سفارش"
      subtitle={order ? <>{order.customer_name} · {faNum(Number(order.order_no.split("-")[1] ?? 0))}#</> : null}
      onClose={onClose}
      closeLabel="بستن پردازش"
      bodyClassName="processing-sheet"
    >
      {order && (
        <>
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
              <Icon name="receipt" size="md" />
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
    </BottomSheet>
  );
}
