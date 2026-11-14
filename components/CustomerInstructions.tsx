"use client";

import { useState } from "react";
import BottomSheet from "@/components/mobile/BottomSheet";
import { FieldArea } from "@/components/FieldInput";
import { GoButton } from "@/components/tapflow/Answer";
import { Icon } from "@/components/meridian/Icon";
import { friendlyError } from "@/lib/userMessage";

const BTN = "inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-4)] text-[length:var(--text-sm)]";

/** F69 on the customer page: one standing note the driver sees on this customer's stop (gate code, parking, who receives). */
export default function CustomerInstructions({ customerId, name, text, codeRequired, onChanged }: { customerId: number; name: string; text: string | null; codeRequired: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(text ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/customers/${customerId}/instructions`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: draft }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (res?.ok) { setOpen(false); onChanged(); } else setError(friendlyError(j?.error, "ذخیره نشد؛ دوباره تلاش کنید"));
  }
  async function toggleCode() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/customers/${customerId}/instructions`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code_required: !codeRequired }) }).catch(() => null);
    setBusy(false);
    if (res?.ok) onChanged(); else setError("ذخیره نشد؛ دوباره تلاش کنید");
  }
  return (
    <section className="card flex flex-wrap items-center justify-between gap-[var(--space-2)] p-[var(--space-4)]" dir="rtl" data-tour="delivery-instructions" aria-label="نکتهٔ تحویل">
      <span className="text-[length:var(--text-sm)]"><b>نکتهٔ تحویل:</b> {text ?? <span className="text-[var(--muted)]">ندارد (کد در، پارکینگ، تحویل‌گیرنده…)</span>}</span>
      <button type="button" className={BTN} onClick={() => { setDraft(text ?? ""); setOpen(true); }}><Icon name="edit" size="md" />ویرایش نکتهٔ تحویل</button>
      <button type="button" className={BTN} data-tour="delivery-code" disabled={busy} onClick={() => void toggleCode()}><Icon name="key" size="md" />{codeRequired ? "کد تحویل: روشن" : "کد تحویل: خاموش"}</button>
      {error && !open ? <p className="m-0 w-full text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
      {open ? (
        <BottomSheet open title="نکتهٔ تحویل" subtitle={name} onClose={() => setOpen(false)} closeLabel="بستن">
          <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
            <FieldArea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="مثلاً: زنگ دوم، کد در ۱۲۳۴، تحویل به آقای رضایی" rows={3} className="w-full resize-none" />
            <p className="m-0 text-[length:var(--text-xs)] text-[var(--muted)]">راننده این را روی توقف همین مشتری می‌بیند. کد در را فقط اینجا بنویسید، نه در یادداشت سفارش.</p>
            {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
            <GoButton icon="save" isDisabled={busy} onPress={() => void save()}>ذخیره</GoButton>
          </div>
        </BottomSheet>
      ) : null}
    </section>
  );
}
