"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BottomSheet from "@/components/mobile/BottomSheet";
import DayChips from "@/components/mobile/DayChips";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import { FieldInput } from "@/components/FieldInput";
import { GoButton } from "@/components/tapflow/Answer";
import { Icon } from "@/components/meridian/Icon";
import { useToast } from "@/components/ToastProvider";
import { friendlyError } from "@/lib/userMessage";
import { tehranTodayIso } from "@/lib/jalali";
import { ORDER_DETAIL_FIELDS, isOrderDetailField, type OrderDetailField } from "@/lib/orderEdits";

/** F48 + F73: on a confirmed order, a manager changes the delivery day, due date, address or notes, always with a reason.
 *  The owner's change applies at once; a manager's goes to the owner for approval. Either way it lands on the order timeline. */
export default function OrderDetailEdit({ orderId, orderNo, isOwner }: { orderId: number; orderNo: string; isOwner: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<OrderDetailField>("requested_day");
  const [text, setText] = useState("");
  const [day, setDay] = useState(tehranTodayIso());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const def = ORDER_DETAIL_FIELDS.find((f) => f.id === field)!;

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/sales/orders/${orderId}/detail`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ field, value: def.kind === "date" ? day : text, reason }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string; result?: "applied" | "pending" } | undefined;
    setBusy(false);
    if (!res?.ok) return setError(friendlyError(j?.error, "ذخیره نشد؛ دوباره تلاش کنید"));
    setOpen(false);
    setText("");
    setReason("");
    toast(j?.result === "pending" ? "برای تأیید مالک فرستاده شد." : "تغییر ذخیره شد.");
    router.refresh();
  }

  return (
    <>
      <button type="button" className="btn ghost touch" data-tour="order-detail-edit" onClick={() => setOpen(true)}>
        <Icon name="edit" size="md" />
        اصلاح جزئیات
      </button>
      {open ? (
        <BottomSheet open title="اصلاح جزئیات سفارش" subtitle={orderNo} onClose={() => setOpen(false)} closeLabel="بستن اصلاح جزئیات" dirty={text !== "" || reason !== ""}>
          <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
            <ChipGroup wrap group={{ id: "field", label: "چه چیزی", mode: "single", neutral: "__none", value: field, onChange: (v) => { if (typeof v === "string" && isOrderDetailField(v)) setField(v); }, options: ORDER_DETAIL_FIELDS.map((f) => ({ id: f.id, label: f.label })) }} />
            {def.kind === "date" ? <DayChips value={day} onChange={setDay} ariaLabel={def.label} count={10} /> : <FieldInput value={text} onChange={(e) => setText(e.target.value)} maxLength={def.max} placeholder={`${def.label} تازه`} aria-label={`${def.label} تازه`} />}
            <FieldInput value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="دلیل (لازم است)" aria-label="دلیل تغییر" />
            <p className="m-0 text-[length:var(--text-xs)] text-[var(--muted)]">{isOwner ? "تغییر همین حالا اعمال می‌شود و با دلیلش در تاریخچهٔ سفارش می‌ماند." : "تغییر بعد از تأیید مالک اعمال می‌شود؛ اگر تا ۳ روز جواب ندهد منقضی می‌شود."}</p>
            {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
            <GoButton icon="save" isDisabled={busy || !reason.trim() || (def.kind === "text" && !text.trim())} onPress={() => void save()}>{isOwner ? "ذخیرهٔ تغییر" : "فرستادن برای تأیید"}</GoButton>
          </div>
        </BottomSheet>
      ) : null}
    </>
  );
}
