"use client";

import { useEffect } from "react";
import Link from "next/link";
import CustomerBento, { useCustomerSummary } from "./CustomerBento";
import { Icon } from "@/components/meridian/Icon";
import { faDigits } from "@/lib/format";

/** پنجرهٔ مشتری — the artifact's bottom bento sheet.
 *
 *  One component for both surfaces: the sales pockets open it, and so does the map. The
 *  alternative was a second copy on the map, which is how the map ended up with a
 *  customer panel that had drifted from the design in the first place.
 *
 *  Figures are fetched on open rather than shipped with the page: the orders list renders
 *  a hundred cards, and pre-loading a ninety-day summary for each would be a hundred
 *  aggregate queries for the one the reader might tap.
 */
export default function CustomerSheet({
  customerId,
  fallbackName,
  onClose,
}: {
  /** null closes the sheet. */
  customerId: number | null;
  /** Shown while the figures are still in flight, so the sheet opens with a title. */
  fallbackName?: string;
  onClose: () => void;
}) {
  const data = useCustomerSummary(customerId);
  const failed = false;

  useEffect(() => {
    if (customerId === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [customerId, onClose]);

  const open = customerId !== null;

  return (
    <>
      <div className={`meridian-scrim${open ? " on" : ""}`} onClick={onClose} aria-hidden />
      <div
        className={`sheet${open ? " on" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sh-name"
        aria-hidden={!open}
      >
        <div className="grab" />
        <div className="sheethead">
          <div>
            <h2 id="sh-name">{data?.business_name ?? fallbackName ?? "مشتری"}</h2>
            <div className="s">
              {data
                ? [
                    data.where,
                    // The district code a rep can read out over the phone, right after the
                    // place name it belongs to. faDigits because it is stored ASCII.
                    data.district_code && faDigits(data.district_code),
                    data.status,
                    data.salesperson && `فروشنده: ${data.salesperson}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : failed
                  ? "اطلاعات این مشتری خوانده نشد"
                  : "در حال خواندن…"}
            </div>
          </div>
          <button className="x" type="button" aria-label="بستن مشخصات مشتری" onClick={onClose}>
            <Icon name="x" size="sm" />
          </button>
        </div>

        <CustomerBento data={data} />
        {customerId !== null && <div style={{ padding: "16px 24px", display: "flex", flexWrap: "wrap", gap: 9 }}>
          <Link className="btn ghost" style={{ minHeight: 44 }} href={`/crm/${customerId}`}>اطلاعات و مخاطبان</Link>
          <Link className="btn solid" style={{ minHeight: 44 }} href={`/sales/orders/new?customer=${customerId}`}>ثبت سفارش تازه</Link>
        </div>}

        {data && (
          <div style={{ padding: "0 24px 26px", display: "flex", gap: 9, justifyContent: "flex-end" }}>
            <Link className="btn ghost" href={`/map?c=${data.customer_id}`}>
              روی نقشه
            </Link>
            <Link className="btn solid" href={`/sales/orders?customer=${data.customer_id}`}>
              همهٔ سفارش‌ها
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
