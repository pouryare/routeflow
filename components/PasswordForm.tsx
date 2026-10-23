"use client";

import { useState } from "react";
import { friendlyError } from "@/lib/userMessage";
import { Icon } from "@/components/meridian/Icon";

const MIN_PASSWORD = 8;

const FIELD =
  "mb-[var(--space-3)] w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-4)] py-[var(--space-2)] text-right font-mono text-[length:var(--text-base)] text-[var(--text)] outline-none focus:border-[var(--accent)] focus:shadow-[0_0_0_2px_var(--accent)]";

/** Choosing a new password, in the two places it happens: the forced change after an owner
 *  set one (/password, F35) and a change by choice (/settings/security). One form so the two
 *  cannot drift on length, the repeat check or the error wording.
 *
 *  `askCurrent` adds the current password, which /api/me/password requires for a change by
 *  choice; the forced change has no current password worth asking for. */
export default function PasswordForm({
  askCurrent,
  submitLabel,
  autoFocus = false,
  onSaved,
}: {
  askCurrent: boolean;
  submitLabel: string;
  autoFocus?: boolean;
  onSaved: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const tooShort = password.length < MIN_PASSWORD;
  const mismatch = repeat.length > 0 && repeat !== password;
  const blocked = saving || tooShort || repeat !== password || (askCurrent && current.length === 0);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (blocked) return;
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(askCurrent ? { password, current } : { password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(friendlyError(data.error, "رمز ذخیره نشد؛ دوباره تلاش کنید"));
        setSaving(false);
        return;
      }
      setSaving(false);
      setCurrent("");
      setPassword("");
      setRepeat("");
      onSaved();
    } catch {
      setError("اتصال برقرار نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      {askCurrent && (
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          رمز فعلی
          <input
            type="password"
            autoFocus={autoFocus}
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            dir="ltr"
            className={FIELD}
          />
        </label>
      )}
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        رمز تازه (حداقل {MIN_PASSWORD.toLocaleString("fa-IR")} نویسه)
        <input
          type="password"
          autoFocus={autoFocus && !askCurrent}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          dir="ltr"
          className={FIELD}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        تکرار رمز
        <input
          type="password"
          autoComplete="new-password"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          dir="ltr"
          className={FIELD}
        />
      </label>
      {mismatch && <p className="mb-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--warn)]">دو رمز یکی نیستند.</p>}
      {error && <p role="alert" className="mb-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--crit)]">{error}</p>}
      <button
        type="submit"
        disabled={blocked}
        className="inline-flex min-h-11 w-full items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--accent)] py-[var(--space-2)] font-medium text-[var(--accent-ink)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Icon name="check" size="md" />
        {saving ? "در حال ذخیره…" : submitLabel}
      </button>
    </form>
  );
}
