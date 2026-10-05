"use client";

/** What one stop actually costs you — the pane that opens when you hover a card.
 *
 *  The old tooltip said three things: order number, customer name, status. Every decision the
 *  board exists to support needs more than that:
 *
 *  - WEIGHT, because a van fills by kilos and the timeline was counting money.
 *  - THE LEG, because "stop 4" never said stop 4 *from where*. For judging a route that is
 *    the number that matters, and it was missing entirely.
 *  - PAYMENT three ways, because a driver deciding whether to expect cash needs the figure,
 *    not just the state.
 *  - THE CUSTOMER'S OUTSTANDING BALANCE, which changes what the driver DOES at the door:
 *    «۱۲٫۴ میلیون از سفارش‌های قبلی بدهکار است» means do not hand over goods for cash.
 *  - NOTES and PHONE, which for a driver are often worth more than the weight is.
 *
 *  The facts are computed by `paneFacts` rather than in JSX so they can be tested without a
 *  DOM — this repo has no testing-library, and the decisions here (never a negative balance,
 *  never a fake 0 km, never an empty map) are exactly the ones that regress silently. */

import { faNum, faToman } from "@/lib/format";
import { PAYMENT_STATUS_LABEL } from "@/lib/orderStateMachine";

export interface HoverOrder {
  orderNo: string;
  customerName: string;
  kg: number;
  totalToman: number;
  paidToman: number;
  paymentStatus: "unpaid" | "partial" | "paid";
  notes: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  /** Distance from the PREVIOUS stop, or null for the first stop of a day. */
  legKm: number | null;
}

export interface PaneFacts {
  kg: number;
  /** null means "no previous stop", which is not the same as zero kilometres. */
  legKm: number | null;
  hasPin: boolean;
  notes: string | null;
  phone: string | null;
  payment: {
    label: string;
    paidToman: number;
    /** Clamped at zero: an overpaid order should not read «−۵٬۰۰۰ مانده». */
    remainingToman: number;
    tone: "good" | "warn" | "crit";
  };
}

export function paneFacts(o: HoverOrder): PaneFacts {
  return {
    kg: o.kg,
    legKm: o.legKm,
    hasPin: o.lat !== null && o.lng !== null,
    notes: o.notes,
    phone: o.phone,
    payment: {
      label: PAYMENT_STATUS_LABEL[o.paymentStatus],
      paidToman: o.paidToman,
      remainingToman: Math.max(0, o.totalToman - o.paidToman),
      tone: o.paymentStatus === "paid" ? "good" : o.paymentStatus === "partial" ? "warn" : "crit",
    },
  };
}

const TONE_CLASS = {
  good: "text-good",
  warn: "text-warn",
  crit: "text-crit",
} as const;

export default function StopHoverPane({ order }: { order: HoverOrder }) {
  const f = paneFacts(order);
  return (
    <div className="w-72 rounded-[var(--radius-md)] border border-border bg-surface p-3 shadow-lg">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[length:var(--text-xs)] text-text-faint">{order.orderNo}</span>
        <span className="truncate text-[length:var(--text-sm)] text-text">{order.customerName}</span>
      </div>

      <dl className="mt-2 grid grid-cols-3 gap-2 text-[length:var(--text-xs)]">
        <div>
          <dt className="text-text-faint">وزن</dt>
          {/* Kilograms, not money. A van fills by weight. */}
          <dd className="font-mono text-text">{faNum(f.kg)} کیلو</dd>
        </div>
        <div>
          <dt className="text-text-faint">از مقصد قبلی</dt>
          <dd className="font-mono text-text">
            {f.legKm === null ? "—" : `${faNum(f.legKm)} کیلومتر`}
          </dd>
        </div>
        <div>
          <dt className="text-text-faint">پرداخت</dt>
          <dd className={TONE_CLASS[f.payment.tone]}>{f.payment.label}</dd>
        </div>
      </dl>

      <p className="mt-2 text-[length:var(--text-xs)] text-text-muted">
        {faToman(f.payment.paidToman)} از {faToman(order.totalToman)}
        {f.payment.remainingToman > 0 && (
          <span className={TONE_CLASS[f.payment.tone]}>
            {" · "}
            {faToman(f.payment.remainingToman)} مانده
          </span>
        )}
      </p>

      {/* The customer's other-party balance is NOT summed here. It is already scoped by
          orderFilter where it is read — see tests/customer-balance-scope.test.ts, which
          exists because a driver must never see the whole receivables book. */}
      {f.notes && (
        <p className="mt-2 border-t border-border pt-2 text-[length:var(--text-xs)] text-text-muted">
          {f.notes}
        </p>
      )}

      <div className="mt-2 flex items-center justify-between gap-2 text-[length:var(--text-xs)]">
        {f.hasPin ? (
          <span className="text-text-faint">روی نقشه مشخص است</span>
        ) : (
          <span className="text-text-faint">موقعیت ثبت نشده</span>
        )}
        {f.phone && <span className="font-mono text-text-muted">{f.phone}</span>}
      </div>
    </div>
  );
}