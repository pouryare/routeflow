"use client";

import Link from "next/link";
import { useState } from "react";
import BottomSheet from "@/components/mobile/BottomSheet";
import { Icon } from "@/components/meridian/Icon";
import { faToman } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import { ORDER_STATUS_LABEL, type OrderStatus } from "@/lib/orderStateMachine";
import type { Snapshot } from "@/lib/repo/crm/snapshot";

const BTN = "inline-flex min-h-[44px] flex-1 items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-4)] text-[length:var(--text-sm)] no-underline";

/** F104: a row of «تماس‌های امروز». A tap opens the pre-call card (balance, last order, last note, open tasks) instead of the
 *  whole customer page; the page is one button away. */
export default function CallSnapshotRow({ customerId, label, sub }: { customerId: number; label: string; sub?: string }) {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<Snapshot | null>(null);
  const [failed, setFailed] = useState(false);

  async function show() {
    setOpen(true);
    if (s) return;
    setFailed(false);
    const res = await fetch(`/api/crm/businesses/${customerId}/snapshot`).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { snapshot?: Snapshot } | null;
    if (j?.snapshot) setS(j.snapshot);
    else setFailed(true);
  }

  return (
    <li className="border-b border-[var(--border)] py-[10px] last:border-b-0">
      <button type="button" onClick={() => void show()} className="flex min-h-11 w-full items-baseline justify-between gap-[var(--space-2)] bg-transparent p-0 text-start"><Icon name="phone" size="sm" />
        <span className="text-[var(--foreground)]">{label}</span>
        {sub ? <span className="text-[length:12px] text-[var(--muted)]">{sub}</span> : null}
      </button>
      {open ? (
        <BottomSheet open title={label} subtitle="پیش از تماس" onClose={() => setOpen(false)} closeLabel="بستن">
          <div className="flex flex-col gap-[var(--space-3)] text-[length:var(--text-sm)]" dir="rtl">
            {failed ? <p className="m-0" style={{ color: "var(--danger)" }}>خوانده نشد؛ دوباره باز کنید</p> : null}
            {!s && !failed ? <p className="m-0 text-[var(--muted)]">در حال خواندن…</p> : null}
            {s ? (
              <>
                {s.holdReason ? <p className="m-0" role="status" style={{ color: "var(--warning)" }}>سفارش‌های تازه نگه داشته شده: {s.holdReason}</p> : null}
                <p className="m-0"><b>بدهی:</b> {s.debtToman > 0 ? `${faToman(s.debtToman)}${s.overdueToman > 0 ? ` (${faToman(s.overdueToman)} بیش از ۳۰ روز)` : ""}` : "بدهی ندارد"}</p>
                <p className="m-0"><b>آخرین سفارش:</b> {s.lastOrder ? `${s.lastOrder.order_no} · ${faJalaliDate(s.lastOrder.order_date)} · ${ORDER_STATUS_LABEL[s.lastOrder.status as OrderStatus] ?? "نامشخص"}` : "سفارشی نداشته"}</p>
                <p className="m-0"><b>آخرین یادداشت:</b> {s.lastNote ? s.lastNote.note : "یادداشتی نیست"}</p>
                {s.openTasks.length > 0 ? <p className="m-0"><b>کارهای باز:</b> {s.openTasks.map((t) => t.title).join(" · ")}</p> : null}
                <div className="flex flex-wrap gap-[var(--space-2)]">
                  {s.phone ? <a className={BTN} href={`tel:${s.phone}`}><Icon name="phone" size="md" />تماس</a> : null}
                  <Link className={BTN} href={`/crm/${s.id}`}><Icon name="user" size="md" />پروندهٔ مشتری</Link>
                </div>
              </>
            ) : null}
          </div>
        </BottomSheet>
      ) : null}
    </li>
  );
}
