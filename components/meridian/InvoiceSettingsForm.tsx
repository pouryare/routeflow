"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FieldInput } from "@/components/FieldInput";
import { Icon } from "@/components/meridian/Icon";
import { toNumber } from "@/lib/money";
import { friendlyError } from "@/lib/userMessage";
import type { InvoiceSettings } from "@/lib/repo/invoice";

const BTN = "inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-4)] text-[length:var(--text-sm)]";

/** D7, on the owner's status page: the company's tax code and the VAT rate every product follows unless it has its own. */
export default function InvoiceSettingsForm({ current }: { current: InvoiceSettings }) {
  const router = useRouter();
  const [taxId, setTaxId] = useState(current.taxId ?? "");
  const [pct, setPct] = useState(String(current.vatDefaultPct));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/admin/invoice-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taxId, vatDefaultPct: toNumber(pct) }),
    }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (!res?.ok) return setMsg({ ok: false, text: friendlyError(j?.error, "ذخیره نشد؛ دوباره تلاش کنید") });
    setMsg({ ok: true, text: "ذخیره شد" });
    router.refresh();
  }

  const label = "flex flex-col gap-[var(--space-1)] text-[length:var(--text-sm)]";
  return (
    <section data-tour="company:invoice" className="card flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" dir="rtl">
      <h2 className="sechead__title">فاکتور رسمی</h2>
      <label className={label}>
        کد اقتصادی شرکت
        <FieldInput value={taxId} onChange={(e) => setTaxId(e.target.value)} inputMode="numeric" maxLength={14} dir="ltr" />
      </label>
      <label className={label}>
        درصد مالیات بر ارزش افزوده
        <FieldInput value={pct} onChange={(e) => setPct(e.target.value)} inputMode="numeric" maxLength={3} dir="ltr" />
        <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
          قیمت‌ها از قبل مالیات را دارند؛ فاکتور رسمی فقط سهم مالیات را جدا می‌کند. هر کالا می‌تواند درصد خودش را داشته باشد (صفحهٔ موجودی).
        </span>
      </label>
      {msg ? <p className="m-0 text-[length:var(--text-xs)]" style={{ color: msg.ok ? "var(--success)" : "var(--danger)" }}>{msg.text}</p> : null}
      <button type="button" disabled={busy} onClick={() => void save()} className={`${BTN} self-start bg-[var(--accent)] text-accent-ink`}>
        <Icon name="save" size="md" />
        ذخیرهٔ فاکتور رسمی
      </button>
    </section>
  );
}
