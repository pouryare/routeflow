"use client";

import { useState } from "react";
import KeypadField from "@/components/mobile/KeypadField";
import { Icon } from "@/components/meridian/Icon";
import { friendlyError } from "@/lib/userMessage";
import { IDLE_ROLES, type IdleRules } from "@/lib/idleSignout";

const LABEL: Record<(typeof IDLE_ROLES)[number], string> = { owner: "مالک", group_manager: "مدیر گروه", rep_manager: "مدیر ویزیتورها", shareholder: "سهام‌دار" };

/** «خروج خودکار بی‌فعالیت», on the owner's status page (E17): after how many idle hours each role signs in again.
 *  Empty or 0 = never. Drivers and reps are not listed: their phone must keep working with no signal. Example:
 *  owner 12 → an owner's laptop left open overnight asks for the password in the morning. */
export default function IdleSignoutForm({ rules }: { rules: IdleRules }) {
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(IDLE_ROLES.map((r) => [r, rules[r] ? String(rules[r]) : ""])));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const res = await fetch("/api/admin/idle-signout", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hours: Object.fromEntries(IDLE_ROLES.map((r) => [r, Number(v[r] || 0)])) }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    setMsg(res?.ok ? { ok: true, text: "ذخیره شد" } : { ok: false, text: friendlyError(j?.error, "ذخیره نشد؛ دوباره تلاش کنید") });
  }
  return (
    <section className="card flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" dir="rtl" data-tour="idle-signout">
      <h2 className="sechead__title">خروج خودکار بی‌فعالیت</h2>
      <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">
        اگر کسی این‌قدر ساعت از برنامه استفاده نکند، دفعهٔ بعد باید دوباره وارد شود. خالی یعنی هرگز. ویزیتورها و رانندگان همیشه وارد می‌مانند تا کار بدون اینترنت از دست نرود.
      </p>
      {IDLE_ROLES.map((r) => (
        <KeypadField key={r} label={LABEL[r]} value={v[r]} onChange={(x) => setV((s) => ({ ...s, [r]: x }))} unit="ساعت" />
      ))}
      {msg ? <p className="m-0 text-[length:var(--text-xs)]" style={{ color: msg.ok ? "var(--success)" : "var(--danger)" }}>{msg.text}</p> : null}
      <button type="button" disabled={busy} onClick={() => void save()} className="inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] self-start rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--accent)] px-[var(--space-4)] text-[length:var(--text-sm)] text-accent-ink">
        <Icon name="save" size="md" />
        ذخیرهٔ خروج خودکار
      </button>
    </section>
  );
}
