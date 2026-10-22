"use client";

import { faToman } from "@/lib/format";
import { METHOD_LABEL, paymentTotals } from "@/lib/paymentsView";

/** Today / week / month receipts by method. Voided receipts are excluded upstream: counting returned money would be the most misleading number here. */
export default function PaymentTotalsCards({ totals }: {
  totals: ReturnType<typeof paymentTotals>;
}) {
  return (
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
  );
}
