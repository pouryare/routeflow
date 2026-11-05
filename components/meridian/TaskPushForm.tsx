"use client";

import { useState } from "react";
import KeypadField from "@/components/mobile/KeypadField";
import { Icon } from "@/components/meridian/Icon";
import { friendlyError } from "@/lib/userMessage";

/** S19, on the owner's status page: how long before a task with a set time its person is pinged. */
export default function TaskPushForm({ minutes }: { minutes: number }) {
  const [value, setValue] = useState(String(minutes));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const res = await fetch("/api/admin/task-push", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ minutes: Number(value) }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    setMsg(res?.ok ? { ok: true, text: "ذخیره شد" } : { ok: false, text: friendlyError(j?.error, "ذخیره نشد؛ دوباره تلاش کنید") });
  }
  return (
    <section className="card flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" dir="rtl">
      <h2 className="sechead__title">یادآوری کارهای ساعت‌دار</h2>
      <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">کسی که کار به او سپرده شده، این‌قدر پیش از ساعت کار یک اعلان می‌گیرد.</p>
      <KeypadField label="چند دقیقه پیش از کار" value={value} onChange={setValue} unit="دقیقه" />
      {msg ? <p className="m-0 text-[length:var(--text-xs)]" style={{ color: msg.ok ? "var(--good)" : "var(--crit)" }}>{msg.text}</p> : null}
      <button type="button" disabled={busy} onClick={() => void save()} className="inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] self-start rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--accent)] px-[var(--space-4)] text-[length:var(--text-sm)] text-accent-ink">
        <Icon name="save" size="md" />
        ذخیرهٔ زمان یادآوری
      </button>
    </section>
  );
}
