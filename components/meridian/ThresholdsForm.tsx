"use client";

import { useState } from "react";
import KeypadField from "@/components/mobile/KeypadField";
import { Icon } from "@/components/meridian/Icon";
import { friendlyError } from "@/lib/userMessage";
import { DEFAULT_THRESHOLDS, THRESHOLDS, type Thresholds } from "@/lib/thresholds";

/** «حدهای هشدار», on the owner's status page (D30): the numbers the app judges by. Example: «مشتری ساکت ۴۵ روز»
 *  → 30 puts a buying customer on the map's quiet list after a month. */
export default function ThresholdsForm({ values }: { values: Thresholds }) {
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(THRESHOLDS.map((t) => [t.key, String(values[t.key])])));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(next: Record<string, string>) {
    setBusy(true);
    const res = await fetch("/api/admin/thresholds", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: Object.fromEntries(Object.entries(next).map(([k, x]) => [k, Number(x)])) }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    setMsg(res?.ok ? { ok: true, text: "ذخیره شد" } : { ok: false, text: friendlyError(j?.error, "ذخیره نشد؛ دوباره تلاش کنید") });
  }
  function reset() {
    const d = Object.fromEntries(THRESHOLDS.map((t) => [t.key, String(DEFAULT_THRESHOLDS[t.key])]));
    setV(d);
    void save(d);
  }
  return (
    <section className="card flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" dir="rtl" data-tour="thresholds">
      <h2 className="sechead__title">حدهای هشدار</h2>
      <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">عددهایی که برنامه با آن‌ها قضاوت می‌کند. مقدار پیش‌فرض همان است که تا امروز بود.</p>
      {THRESHOLDS.map((t) => (
        <div key={t.key} className="flex flex-col gap-[var(--space-1)]">
          <KeypadField label={t.label} value={v[t.key]} onChange={(x) => setV((s) => ({ ...s, [t.key]: x }))} unit={t.unit} />
          <p className="m-0 text-[length:var(--text-xs)] text-[var(--muted)]">{t.hint}</p>
        </div>
      ))}
      {msg ? <p className="m-0 text-[length:var(--text-xs)]" style={{ color: msg.ok ? "var(--success)" : "var(--danger)" }}>{msg.text}</p> : null}
      <div className="flex flex-wrap gap-[var(--space-2)]">
        <button type="button" disabled={busy} onClick={() => void save(v)} className="inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--accent)] px-[var(--space-4)] text-[length:var(--text-sm)] text-accent-ink">
          <Icon name="save" size="md" />
          ذخیرهٔ حدها
        </button>
        <button type="button" disabled={busy} onClick={reset} className="inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-4)] text-[length:var(--text-sm)]">
          <Icon name="undo" size="md" />
          برگرداندن به پیش‌فرض
        </button>
      </div>
    </section>
  );
}
