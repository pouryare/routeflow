"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FieldInput } from "@/components/FieldInput";
import { Icon } from "@/components/meridian/Icon";
import { DEFAULT_RECEIPT_FOOTER, type DocumentSettings } from "@/lib/documentSettings";
import { friendlyError } from "@/lib/userMessage";

const BTN = "inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-4)] text-[length:var(--text-sm)]";

/** A13, on the owner's status page: the last line of the receipt and the delivery note, and the
 *  letters in front of every new order number. Old numbers keep what they had. */
export default function DocumentSettingsForm({ current }: { current: DocumentSettings }) {
  const router = useRouter();
  const [receipt, setReceipt] = useState(current.receiptFooter ?? "");
  const [note, setNote] = useState(current.deliveryNoteFooter ?? "");
  const [prefix, setPrefix] = useState(current.orderPrefix ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/admin/document-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receiptFooter: receipt, deliveryNoteFooter: note, orderPrefix: prefix }),
    }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (!res?.ok) return setMsg({ ok: false, text: friendlyError(j?.error, "ذخیره نشد؛ دوباره تلاش کنید") });
    setMsg({ ok: true, text: "ذخیره شد" });
    router.refresh();
  }

  const label = "flex flex-col gap-[var(--space-1)] text-[length:var(--text-sm)]";
  return (
    <section className="card flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" dir="rtl">
      <h2 className="sechead__title">برگه‌های چاپی</h2>
      <label className={label}>
        پایین رسید
        <FieldInput value={receipt} onChange={(e) => setReceipt(e.target.value)} placeholder={DEFAULT_RECEIPT_FOOTER} maxLength={160} />
      </label>
      <label className={label}>
        پایین برگهٔ تحویل
        <FieldInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="خالی: چیزی چاپ نمی‌شود" maxLength={160} />
      </label>
      <label className={label}>
        پیشوند شمارهٔ سفارش
        <FieldInput value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} placeholder="مثلاً RF" maxLength={4} dir="ltr" autoCapitalize="characters" />
        <span className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
          فقط برای سفارش‌های تازه، مثل {prefix || "RF"}1405-00001. شمارهٔ سفارش‌های قبلی عوض نمی‌شود.
        </span>
      </label>
      {msg ? <p className="m-0 text-[length:var(--text-xs)]" style={{ color: msg.ok ? "var(--good)" : "var(--crit)" }}>{msg.text}</p> : null}
      <button type="button" disabled={busy} onClick={() => void save()} className={`${BTN} self-start bg-[var(--accent)] text-accent-ink`}>
        <Icon name="save" size="md" />
        ذخیرهٔ کاغذها
      </button>
    </section>
  );
}
