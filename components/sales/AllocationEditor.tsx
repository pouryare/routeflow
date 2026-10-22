"use client";

import type { Dispatch, SetStateAction } from "react";
import { Icon } from "@/components/meridian/Icon";
import SectionHead from "@/components/meridian/SectionHead";
import { faToman } from "@/lib/format";
import { type AllocationDraft, type OpenOrder, type Payment } from "@/lib/paymentsView";

/** The dialog that re-splits one receipt between orders and the customer's account. */
export default function AllocationEditor({ editing, draft, setDraft, openOrders, payments, allocError, saveAllocation, setEditing, setAllocError }: {
  editing: number | null;
  draft: AllocationDraft[];
  setDraft: Dispatch<SetStateAction<AllocationDraft[]>>;
  openOrders: OpenOrder[];
  payments: Payment[] | null;
  allocError: string | null;
  saveAllocation: () => void;
  setEditing: (id: number | null) => void;
  setAllocError: (e: string | null) => void;
}) {
  return (
editing !== null ? (
        <div
          role="dialog"
          aria-label="ویرایش تخصیص"
          className="flex flex-col gap-2 rounded border border-border bg-surface p-3 text-sm"
        >
          <SectionHead title="تخصیص این دریافت" as="h3" />
          <p className="text-xs text-text-muted">
            پیش‌فرض روی قدیمی‌ترین سفارش‌ها می‌نشیند و باقی‌مانده به حساب مشتری. اینجا می‌توانید
            دستی عوضش کنید؛ پول جابه‌جا نمی‌شود، فقط نسبتش با سفارش‌ها.
          </p>
          {openOrders.map((o) => {
            const outstanding = Math.max(0, o.total_toman - o.paid_toman);
            return (
              <label key={o.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="tnum">
                  سفارش {o.id} — مانده {faToman(outstanding)}
                </span>
                <input
                  type="number"
                  min={0}
                  step={1000}
                  value={
                    draft.find((d) => d.order_id === o.id)?.amount_toman ?? 0
                  }
                  onChange={(e) => {
                    const v = Number(e.target.value.replace(/[^\d]/g, ""));
                    setDraft((prev) => {
                      const rest = prev.filter((d) => d.order_id !== o.id);
                      return [...rest, { order_id: o.id, amount_toman: v }];
                    });
                  }}
                  className="w-28 rounded border border-border bg-bg p-1 text-left font-mono"
                />
              </label>
            );
          })}
          {/* order_id NULL is on-account credit. It is an explicit field rather than a
              silent remainder, because "what is left" is a number someone will ask about. */}
          <label className="flex items-center justify-between gap-2 text-xs">
            <span>باقی‌مانده روی حساب مشتری</span>
            <input
              type="number"
              min={0}
              step={1000}
              value={draft.find((d) => d.order_id === null)?.amount_toman ?? 0}
              onChange={(e) => {
                const v = Number(e.target.value.replace(/[^\d]/g, ""));
                setDraft((prev) => [
                  ...prev.filter((d) => d.order_id !== null),
                  { order_id: null, amount_toman: v },
                ]);
              }}
              className="w-28 rounded border border-border bg-bg p-1 text-left font-mono"
            />
          </label>
          <p className="text-xs text-text-muted">
            جمع تخصیص:{" "}
            <span className="font-mono">
              {faToman(
                draft.reduce((s, d) => s + (Number.isFinite(d.amount_toman) ? d.amount_toman : 0), 0)
              )}
            </span>{" "}
            از{" "}
            <span className="font-mono">
              {faToman(payments?.find((p) => p.id === editing)?.amount_toman ?? 0)}
            </span>
          </p>
          {allocError ? <p className="text-xs text-danger">{allocError}</p> : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveAllocation}
              className="rounded bg-accent px-3 py-1 text-xs text-white"
            >
              <Icon name="check" size="sm" />
              ذخیرهٔ تخصیص
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setAllocError(null);
              }}
              className="rounded border border-border px-3 py-1 text-xs"
            >
              <Icon name="x" size="sm" />
              انصراف از ویرایش تخصیص
            </button>
          </div>
        </div>
      ) : null
  );
}
