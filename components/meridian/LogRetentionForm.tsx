"use client";

import { useState } from "react";
import KeypadField from "@/components/mobile/KeypadField";
import { Icon } from "@/components/meridian/Icon";
import { friendlyError } from "@/lib/userMessage";
import { faNum } from "@/lib/format";
import type { RetentionRow } from "@/lib/repo/logRetention";

/** «نگهداری گزارش‌های فنی», on the platform owner's status page (FB41): how many days each machine log is kept,
 *  and how many rows tonight's purge would delete. Example: «ورودها: ۹۰ روز · امشب ۱٬۲۰۰ ردیف پاک می‌شود». */
export default function LogRetentionForm({ rows }: { rows: RetentionRow[] }) {
  const [values, setValues] = useState(() => Object.fromEntries(rows.map((r) => [r.id, String(r.days)])));
  const [msg, setMsg] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  async function save(id: string) {
    setBusy(id);
    const res = await fetch("/api/admin/log-retention", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, days: Number(values[id]) }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(null);
    setMsg({ id, ok: !!res?.ok, text: res?.ok ? `ذخیره شد: ${faNum(Number(values[id]))} روز` : friendlyError(j?.error, "ذخیره نشد؛ دوباره تلاش کنید") });
  }
  return (
    <section className="card flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" dir="rtl" data-tour="log-retention">
      <h2 className="sechead__title">نگهداری گزارش‌های فنی</h2>
      <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">
        هر شب ردیف‌های قدیمی‌تر از این مدت پاک می‌شوند تا پایگاه داده بزرگ نشود. فقط گزارش‌های فنی؛ سفارش، دریافت و دفتر هرگز پاک نمی‌شوند.
      </p>
      {rows.map((r) => (
        <div key={r.id} className="flex flex-col gap-[var(--space-2)] border-t border-[var(--border)] pt-[var(--space-3)]">
          <KeypadField label={r.label} value={values[r.id]} onChange={(v) => setValues((s) => ({ ...s, [r.id]: v }))} unit="روز" />
          <p className="m-0 text-[length:var(--text-xs)] text-[var(--muted)]">
            {r.rows === 0 ? "امشب چیزی پاک نمی‌شود" : `با ${faNum(r.days)} روز، امشب ${faNum(r.rows)} ردیف پاک می‌شود`}
          </p>
          {msg?.id === r.id ? <p className="m-0 text-[length:var(--text-xs)]" style={{ color: msg.ok ? "var(--success)" : "var(--danger)" }}>{msg.text}</p> : null}
          <button type="button" disabled={busy === r.id} onClick={() => void save(r.id)} className="inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] self-start rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--accent)] px-[var(--space-4)] text-[length:var(--text-sm)] text-accent-ink">
            <Icon name="save" size="md" />
            ذخیره
          </button>
        </div>
      ))}
    </section>
  );
}
