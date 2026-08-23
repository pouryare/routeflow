"use client";

import { useEffect, useState } from "react";
import { faNum } from "@/lib/format";

interface SaleOrder {
  order_no: string | null;
  sale_date: string;
  product_name: string | null;
  qty: number | null;
  amount: number;
  payment_status: string | null;
  shipping_status: string | null;
}

interface TopProduct {
  product_name: string;
  total_amount: number;
  line_count: number;
}

export default function PurchaseHistory({ businessName }: { businessName: string }) {
  const [orders, setOrders] = useState<SaleOrder[] | null>(null);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch(`/api/sales?customer=${encodeURIComponent(businessName)}`)
      .then((r) => r.json())
      .then((d) => {
        setOrders(d.orders ?? []);
        setTopProducts(d.topProducts ?? []);
      });
  }, [businessName]);

  return (
    <div className="mt-4 border-t border-border pt-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-text"
      >
        <span>تاریخچه خرید{orders && orders.length > 0 ? ` (${faNum(orders.length)})` : ""}</span>
        <span
          className="transition-transform duration-[var(--dur-base)] ease-[var(--ease-out)]"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        >
          ▾
        </span>
      </button>
      {open &&
        (orders === null ? (
          <p className="mt-2 text-[length:var(--text-xs)] text-text-faint">در حال بارگذاری…</p>
        ) : orders.length === 0 ? (
          <p className="mt-2 text-[length:var(--text-xs)] text-text-faint">هنوز خریدی ثبت نشده</p>
        ) : (
          <>
            {topProducts.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {topProducts.map((p) => (
                  <span
                    key={p.product_name}
                    className="rounded-full border border-border bg-surface px-2 py-0.5 text-[length:var(--text-xs)] text-text-muted"
                  >
                    {p.product_name} <span className="text-text-faint">({faNum(p.line_count)})</span>
                  </span>
                ))}
              </div>
            )}
            <ul className="mt-2 flex flex-col gap-1.5">
              {orders.slice(0, 15).map((o, i) => (
                <li key={`${o.order_no}-${i}`} className="flex items-center justify-between gap-2 text-[length:var(--text-xs)] leading-5">
                  <div className="min-w-0 flex-1">
                    <span dir="ltr" className="inline-block font-mono text-text-faint">
                      {o.sale_date}
                    </span>{" "}
                    <span className="text-text-muted">{o.product_name ?? "—"}</span>
                  </div>
                  <span className="shrink-0 font-mono tabular-nums text-text">{faNum(o.amount)}</span>
                </li>
              ))}
            </ul>
          </>
        ))}
    </div>
  );
}
