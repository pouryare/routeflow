"use client";

import { useState } from "react";
import { friendlyError } from "@/lib/userMessage";
import { Icon } from "@/components/meridian/Icon";
import { PasswordInput } from "@/components/TextInput";
import { useShakeOn } from "@/lib/useShake";
import { MIN_PASSWORD, passwordRules } from "@/lib/passwordStrength";


/** Choosing a new password, in the two places it happens: the forced change after an owner
 *  set one (/password, F35) and a change by choice (/settings/security). One form so the two
 *  cannot drift on length, the repeat check or the error wording.
 *
 *  `askCurrent` adds the current password, which /api/me/password requires for a change by
 *  choice; the forced change has no current password worth asking for. */
/** A four-step bar and the rules, ticked as you type. */
function PasswordMeter({ password }: { password: string }) {
  const { rules, score } = passwordRules(password);
  return (
    <div className="pwmeter" data-score={score} aria-live="polite">
      <div className="pwmeter__bar" aria-hidden="true">{[1, 2, 3, 4].map((n) => <i key={n} className={n <= score ? "on" : ""} />)}</div>
      <ul className="pwmeter__rules">
        {rules.map((r) => (
          <li key={r.id} className={r.met ? "met" : ""}>
            <Icon name={r.met ? "check" : "x"} size="sm" />
            {r.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

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
  const shakeRef = useShakeOn<HTMLFormElement>(error !== null);

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
    <form ref={shakeRef} onSubmit={onSubmit}>
      {askCurrent && (
        <PasswordInput label="رمز فعلی" autoFocus={autoFocus} autoComplete="current-password" value={current} onChange={setCurrent} />
      )}
      <PasswordInput
        label={`رمز تازه (حداقل ${MIN_PASSWORD.toLocaleString("fa-IR")} نویسه)`}
        autoFocus={autoFocus && !askCurrent}
        autoComplete="new-password"
        value={password}
        onChange={setPassword}
      />
      {password && <PasswordMeter password={password} />}
      <PasswordInput label="تکرار رمز" autoComplete="new-password" value={repeat} onChange={setRepeat} />
      {mismatch && <p className="mb-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--warn)]">دو رمز یکی نیستند.</p>}
      {error && <p role="alert" className="mb-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--crit)]">{error}</p>}
      <button
        type="submit"
        disabled={blocked}
        className="inline-flex min-h-11 w-full items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--accent)] py-[var(--space-2)] font-medium text-[var(--accent-ink)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Icon name="save" size="md" />
        {saving ? "در حال ذخیره…" : submitLabel}
      </button>
    </form>
  );
}
