"use client";

import { FieldInput } from "@/components/FieldInput";
import { safeNextPath } from "@/lib/safeNext";
import { useEffect, useRef, useState, Suspense } from "react";
import { friendlyError } from "@/lib/userMessage";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/meridian/Icon";
import { PasswordInput, TextInput } from "@/components/TextInput";
import OtpInput from "@/components/mobile/OtpInput";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [bounced, setBounced] = useState(false);
  // Set when the password passed but the founder's account also needs a code from the authenticator app.
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const nextPathRef = useRef<string | null>(null);
  const clearedRef = useRef(false);

  // proxy.ts only sets ?next= when it turned someone away from a page they asked for, so
  // its presence means "you were signed in a moment ago, and now you are not". Without
  // saying so, an expired session looks exactly like a broken app: the map they expected
  // is replaced by a form, with no clue why.
  // Clear the param after reading so a refresh/back-navigation doesn't show the banner again.
  useEffect(() => {
    const next = params.get("next");
    if (next && !clearedRef.current) {
      setBounced(true);
      nextPathRef.current = safeNextPath(next);
      clearedRef.current = true;
      // Remove ?next= from URL without triggering navigation
      const url = new URL(window.location.href);
      url.searchParams.delete("next");
      window.history.replaceState({}, "", url.toString());
    }
  }, [params]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await submit();
  }

  /** `typed` is the code the six boxes just completed, which state has not caught up with yet. */
  async function submit(typed?: string) {
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = challenge
        ? await fetch("/api/login/second-factor", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ challenge, code: (typed ?? code).trim() }),
          })
        : await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: username.trim(), password }),
          });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(friendlyError(data.error, "ورود انجام نشد؛ دوباره تلاش کنید"));
        if (challenge) setCode("");
        setLoading(false);
        return;
      }
      if (data.secondFactor) {
        setChallenge(data.challenge);
        setLoading(false);
        return;
      }
      router.push(nextPathRef.current || "/");
      router.refresh();
    } catch {
      setError("اتصال برقرار نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.");
      setLoading(false);
    }
  }

  return (
    <div className="meridian min-h-screen flex items-center justify-center p-[var(--space-4)]">
      <main className="w-full max-w-sm">
        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-raised)] p-[var(--space-6)]">
          <div className="mb-[var(--space-4)] flex items-center justify-center gap-[var(--space-2)]">
            <Icon name="map" size="lg" className="text-[var(--accent)]" />
            <div className="font-mono text-xs tracking-[0.12em] text-[var(--accent)] uppercase">
              RouteFlow
            </div>
          </div>
          <h1 className="mb-[var(--space-1)] text-center text-[length:var(--text-xl)] font-bold text-[var(--text)]">
            نقشه پوشش مشتریان
          </h1>
          <p className="mb-[var(--space-5)] text-center text-[length:var(--text-sm)] text-[var(--text-muted)]">
            با نام کاربری و رمز عبور خودتان وارد شوید.
          </p>

          {bounced && (
            <p
              role="status"
              className="mb-[var(--space-4)] rounded-[var(--radius-md)] border border-[var(--warn)]/40 bg-[var(--warn)]/10 px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--warn)]"
            >
              نشست شما پایان یافته است. برای ادامه دوباره وارد شوید.
            </p>
          )}

          <form onSubmit={onSubmit}>
            {challenge ? (
              useRecovery ? (
                <label className="flex flex-col gap-1 text-xs text-text-muted">کد بازیابی<FieldInput
                  type="text"
                  autoFocus
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  dir="ltr"
                  className="mb-[var(--space-4)] w-full text-center font-mono text-[length:var(--text-lg)] tracking-[0.3em] text-[var(--text)]"
                /></label>
              ) : (
                <div className="mb-[var(--space-4)] flex flex-col gap-[var(--space-3)]">
                  <p className="m-0 text-center text-[length:var(--text-sm)] text-[var(--text-muted)]">کد ۶ رقمی برنامهٔ احراز هویت را وارد کنید.</p>
                  <OtpInput value={code} onChange={setCode} onComplete={(v) => void submit(v)} isInvalid={error !== null} disabled={loading} />
                </div>
              )
            ) : (
            <>
            <TextInput label="نام کاربری" autoFocus autoComplete="username" value={username} onChange={setUsername} />
            <PasswordInput label="رمز عبور" autoComplete="current-password" value={password} onChange={setPassword} className="mb-[var(--space-4)]" />
            </>
            )}
            {challenge && (
              <button
                type="button"
                onClick={() => { setUseRecovery((v) => !v); setCode(""); setError(null); }}
                className="mb-[var(--space-4)] inline-flex min-h-11 w-full items-center justify-center gap-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--accent)]"
              >
                <Icon name="repeat" size="sm" />
                {useRecovery ? "برگشت به کد برنامه" : "کد بازیابی دارم"}
              </button>
            )}
            {error && <p className="mb-[var(--space-4)] text-[length:var(--text-sm)] text-[var(--crit)]">{error}</p>}
            <button
              type="submit"
              disabled={loading || (challenge ? code.trim().length < (useRecovery ? 8 : 6) : !username.trim() || !password)}
              className="inline-flex items-center justify-center gap-[var(--space-2)] w-full cursor-pointer rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--accent)] py-[var(--space-2)] font-medium text-[var(--accent-ink)] transition-[filter,transform,opacity] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:enabled:scale-[1.03] hover:enabled:brightness-110 active:enabled:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon name="logout" size="md" />
              {loading ? "در حال ورود…" : challenge ? "تأیید و ورود" : "ورود به برنامه"}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
