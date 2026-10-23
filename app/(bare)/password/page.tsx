"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { friendlyError } from "@/lib/userMessage";
import { Icon } from "@/components/meridian/Icon";

const MIN_PASSWORD = 8;

const FIELD =
  "mb-[var(--space-3)] w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-4)] py-[var(--space-2)] text-right font-mono text-[length:var(--text-base)] text-[var(--text)] outline-none focus:border-[var(--accent)] focus:shadow-[0_0_0_2px_var(--accent)]";

/** F35: the first sign-in with a password an owner chose lands here (proxy.ts sends every page to
 *  it), and nothing else opens until a new one is saved. Signing out stays possible. */
export default function NewPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const tooShort = password.length < MIN_PASSWORD;
  const mismatch = repeat.length > 0 && repeat !== password;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (tooShort || repeat !== password) return;
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(friendlyError(data.error, "رمز ذخیره نشد؛ دوباره تلاش کنید"));
        setSaving(false);
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("اتصال برقرار نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.");
      setSaving(false);
    }
  }

  async function signOut() {
    await fetch("/api/logout", { method: "POST" }).catch(() => null);
    router.push("/login");
  }

  return (
    <div className="meridian min-h-screen flex items-center justify-center p-[var(--space-4)]">
      <main className="w-full max-w-sm">
        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-raised)] p-[var(--space-6)]">
          <h1 className="mb-[var(--space-1)] text-center text-[length:var(--text-xl)] font-bold text-[var(--text)]">
            رمز عبور تازه
          </h1>
          <p className="mb-[var(--space-5)] text-center text-[length:var(--text-sm)] text-[var(--text-muted)]">
            این رمز را مدیر برایتان گذاشته است. پیش از ادامه، رمزی انتخاب کنید که فقط خودتان می‌دانید.
          </p>
          <form onSubmit={onSubmit}>
            <label className="flex flex-col gap-1 text-xs text-text-muted">
              رمز تازه (حداقل {MIN_PASSWORD.toLocaleString("fa-IR")} نویسه)
              <input
                type="password"
                autoFocus
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
            {error && <p className="mb-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--crit)]">{error}</p>}
            <button
              type="submit"
              disabled={saving || tooShort || repeat !== password}
              className="inline-flex min-h-11 w-full items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--accent)] py-[var(--space-2)] font-medium text-[var(--accent-ink)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon name="check" size="md" />
              {saving ? "در حال ذخیره…" : "ذخیره و ادامه"}
            </button>
          </form>
          <button
            type="button"
            onClick={signOut}
            className="mt-[var(--space-3)] inline-flex min-h-11 w-full items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--text-muted)]"
          >
            <Icon name="logout" size="md" />
            خروج
          </button>
        </div>
      </main>
    </div>
  );
}
