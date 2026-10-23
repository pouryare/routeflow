"use client";

import { useEffect, useState } from "react";
import { faToman } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import type { ProductPrices } from "@/lib/repo/customerPrices";

/** F89: the last prices a customer paid per product and pack, newest first. A price under the
 *  list price of its day is marked, so a past discount is not mistaken for the going rate. */
export function PriceHistoryList({ prices }: { prices: ProductPrices[] }) {
  if (prices.length === 0) return null;
  return (
    <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0 text-[length:var(--text-xs)]">
      {prices.slice(0, 8).map((p) => (
        <li key={`${p.product_id}:${p.packaging_id}`} className="flex flex-col gap-1">
          <span className="text-text">
            {p.product_name} <span className="text-text-faint">· {p.packaging_name}</span>
          </span>
          <span className="flex flex-wrap gap-x-3 gap-y-1 tabular-nums text-text-muted">
            {p.points.map((pt) => {
              const below = pt.list_price_toman !== null && pt.unit_price_toman < pt.list_price_toman;
              return (
                <span key={pt.order_id} title={pt.list_price_toman !== null ? `قیمت فهرست آن روز: ${faToman(pt.list_price_toman)}` : undefined}>
                  <span className={below ? "text-warn" : "text-text"}>{faToman(pt.unit_price_toman)}</span>{" "}
                  <span className="text-text-faint">{faJalaliDate(pt.order_date)}</span>
                  {below && <span className="text-warn"> · زیر قیمت فهرست</span>}
                </span>
              );
            })}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The same list with its own fetch, for the customer page. Shows nothing until there is
 *  something to show, and nothing at all for a shop with no sales. */
export default function CustomerPriceHistory({ customerId }: { customerId: number }) {
  const [prices, setPrices] = useState<ProductPrices[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/sales/orders?customer=${customerId}&limit=1`)
      .then((r) => (r.ok ? r.json() : { prices: [] }))
      .then((d) => {
        if (!cancelled) setPrices(d.prices ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [customerId]);
  if (prices.length === 0) return null;
  return (
    <section className="tile">
      <h2>قیمت‌های اخیر</h2>
      <PriceHistoryList prices={prices} />
    </section>
  );
}
