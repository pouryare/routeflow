"use client";

import { Icon } from "@/components/meridian/Icon";
import { ORDER_STATUS_LABEL } from "@/lib/orderStateMachine";
import { useEffect, useState } from "react";
import Link from "next/link";
import { faNum, faToman } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import { SkeletonLabel, SkeletonRows } from "./Skeleton";

interface OrderSummary {
  id: number;
  order_no: string;
  status: string;
  order_date: string;
  payment_status: string;
  total_toman: number;
  line_count: number;
}

interface ProductMix {
  product_id: number;
  product_name: string;
  packs: number;
  total_toman: number;
}

/* ORDER_STATUS_LABEL, not a local map: a local one keyed `draft`/`delivered` never
   matched the real, uppercase statuses and printed «DELIVERED» to Persian readers. */
const STATUS_LABEL = ORDER_STATUS_LABEL as Record<string, string>;

/** What this shop has bought, inside the map's customer panel.
 *
 *  This is the one place the sales side has to appear inside the map, and it is the
 *  reason the two halves are one product rather than two apps.
 *
 *  It reads `orders` joined on customer_id. The version before this read the legacy
 *  `sales` table joined on the business name as free text -- which meant a renamed shop
 *  silently lost its whole history, and which stopped returning anything at all once
 *  orders became the real record.
 *
 *  Scoping comes free from the endpoint: a manager sees their group's orders for this
 *  shop, a فروشنده only the ones they took.
 */
export default function PurchaseHistory({
  customerId,
  customerName,
}: {
  customerId: number;
  customerName: string;
}) {
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [products, setProducts] = useState<ProductMix[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // No synchronous reset here: the caller keys this component by customer id, so
    // switching shops remounts it and the loading state starts fresh on its own.
    fetch(`/api/sales/orders?customer=${customerId}&limit=20`)
      .then((r) => (r.ok ? r.json() : { orders: [], products: [] }))
      .then((d) => {
        if (cancelled) return;
        setOrders(d.orders ?? []);
        setProducts(d.products ?? []);
      })
      .catch(() => {
        // A driver or a signed-out session gets a 401/403 here. An empty history is a
        // truthful thing to show them; an error banner inside a customer card is not.
        if (!cancelled) setOrders([]);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  const total = (orders ?? []).reduce((sum, o) => sum + o.total_toman, 0);

  return (
    <div className="mt-4 border-t border-border pt-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-text"
      >
        <span>
          سفارش‌ها{orders && orders.length > 0 ? ` (${faNum(orders.length)})` : ""}
        </span>
        <span
          className="transition-transform duration-[var(--dur-base)] ease-[var(--ease-out)]"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        >
          <Icon name="chevron-down" size="sm" />
        </span>
      </button>

      {open && (
        <>
          {orders === null ? (
            <>
              <SkeletonRows rows={2} className="mt-2" />
              <SkeletonLabel>در حال بارگذاری سفارش‌ها…</SkeletonLabel>
            </>
          ) : orders.length === 0 ? (
            <p className="mt-2 text-[length:var(--text-xs)] text-text-faint">
              هنوز سفارشی برای این مشتری ثبت نشده
            </p>
          ) : (
            <>
              {products.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {products.slice(0, 5).map((p) => (
                    <span
                      key={p.product_id}
                      className="rounded-full border border-border bg-surface px-2 py-0.5 text-[length:var(--text-xs)] text-text-muted"
                    >
                      {p.product_name}{" "}
                      <span className="text-text-faint">({faNum(p.packs)} بسته)</span>
                    </span>
                  ))}
                </div>
              )}

              <ul className="mt-2 flex flex-col gap-1.5">
                {orders.slice(0, 8).map((o) => (
                  <li key={o.id}>
                    <Link
                      href={`/sales/orders/${o.id}`}
                      className="flex items-center justify-between gap-2 text-[length:var(--text-xs)] leading-5 no-underline hover:text-accent"
                    >
                      <span className="min-w-0 flex-1 truncate text-text-muted">
                        <span className="font-mono tabular-nums text-text-faint">
                          {faJalaliDate(o.order_date)}
                        </span>{" "}
                        {STATUS_LABEL[o.status] ?? "نامشخص"}
                      </span>
                      <span className="shrink-0 font-mono tabular-nums text-text">
                        {faToman(o.total_toman)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>

              <p className="mt-2 text-[length:var(--text-xs)] tabular-nums text-text-faint">
                جمع {faNum(orders.length)} سفارش اخیر: {faToman(total)}
              </p>
            </>
          )}

          {/* The two actions that make the panel a starting point rather than a dead end.
              Rendered even with no history: the commonest reason a shop has none is that
              nobody has recorded its first order yet. */}
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href={`/sales/orders/new?customer=${customerId}`}
              className="rounded-[var(--radius-md)] border border-accent bg-accent px-3 py-1.5 text-[length:var(--text-xs)] font-medium text-accent-ink no-underline transition-[filter] duration-[var(--dur-base)] hover:brightness-110"
            >
              ثبت سفارش تازه
            </Link>
            <Link
              href={`/sales/orders?customer=${customerId}`}
              className="rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-[length:var(--text-xs)] text-text-muted no-underline transition-colors duration-[var(--dur-base)] hover:border-border-strong hover:text-text"
              title={`همه سفارش‌های ${customerName}`}
            >
              همه سفارش‌ها
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
