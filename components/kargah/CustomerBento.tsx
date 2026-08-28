"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { faNum, faToman } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import type { CustomerSummary } from "@/lib/customerSummary";

/** The three bento tiles of پنجرهٔ مشتری, on their own.
 *
 *  Extracted so the sales sheet and the map's customer panel show the SAME designed
 *  window rather than two drifting copies — which is how the map ended up with a customer
 *  panel that no longer matched the design at all.
 */
export function useCustomerSummary(customerId: number | null) {
  /* Keyed by the customer it belongs to, so the previous customer's figures can never be
     shown under a new name while a request is in flight. */
  const [got, setGot] = useState<{ id: number; data: CustomerSummary | null } | null>(null);

  useEffect(() => {
    if (customerId === null) return;
    let alive = true;
    fetch(`/api/sales/customers/${customerId}/summary`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && setGot({ id: customerId, data: (j?.summary as CustomerSummary) ?? null }))
      .catch(() => alive && setGot({ id: customerId, data: null }));
    return () => {
      alive = false;
    };
  }, [customerId]);

  return got && got.id === customerId ? got.data : null;
}

export default function CustomerBento({
  data,
  compact = false,
}: {
  data: CustomerSummary | null;
  /** The map's panel is 320px wide, so its tiles stack instead of sitting three across. */
  compact?: boolean;
}) {
  const ARC = 170;
  const share = data?.share_of_book ?? 0;

  return (
    <div className={`bento${compact ? " bento--compact" : ""}`}>
      <div className="tile">
        <div className="k">خرید {faNum(data?.window_days ?? 90)} روز گذشته</div>
        <div className="v mono">
          {faNum(data?.spend ?? 0)}
          <span style={{ fontSize: 14, fontWeight: 500, color: "var(--muted)", marginInlineStart: 6 }}>
            تومان
          </span>
        </div>
        <div className="n">
          {faNum(data?.order_count ?? 0)} سفارش · میانگین {faToman(data?.average ?? 0)}
        </div>
        <div className="minirow">
          <div className="mini">
            <div className="k">وزن کل</div>
            <div className="v">{faNum(Math.round(data?.kg ?? 0))}</div>
          </div>
          <div className="mini">
            <div className="k">آخرین خرید</div>
            <div className="v" style={{ fontSize: 13 }}>
              {data?.last_purchase_date ? faJalaliDate(data.last_purchase_date) : "—"}
            </div>
          </div>
          <div className="mini">
            <div className="k">مانده</div>
            <div className="v" style={{ color: (data?.balance ?? 0) > 0 ? "var(--accent)" : undefined }}>
              {faNum(data?.balance ?? 0)}
            </div>
          </div>
        </div>
      </div>

      <div className="tile">
        <div className="k">سفارش‌های اخیر</div>
        <div style={{ marginTop: 8 }}>
          {(data?.recent ?? []).length === 0 ? (
            <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--muted)" }}>
              {data ? "در این بازه سفارش تحویل‌شده‌ای ندارد." : "…"}
            </p>
          ) : (
            data!.recent.map((o) => (
              <Link key={o.id} href={`/sales/orders/${o.id}`} className="ordline">
                <span>{faNum(Number(o.order_no.split("-")[1] ?? 0))}#</span>
                <span className="mono">{faNum(o.total_toman)}</span>
              </Link>
            ))
          )}
        </div>
      </div>

      <div className="tile" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <div className="k">سهم از کل فروش</div>
        <div className="arc">
          <svg viewBox="0 0 132 78" role="img" aria-label={`سهم ${Math.round(share * 100)} درصدی از کل فروش`}>
            <path className="track" d="M 12 70 A 54 54 0 0 1 120 70" />
            <path
              className="val"
              d="M 12 70 A 54 54 0 0 1 120 70"
              style={{ strokeDasharray: ARC, strokeDashoffset: ARC * (1 - share) }}
            />
          </svg>
          <div className="c">
            <b className="mono">{faNum(Math.round(share * 100))}٪</b>
            <span>از فروش {faNum(data?.window_days ?? 90)} روز اخیر</span>
          </div>
        </div>
      </div>
    </div>
  );
}
