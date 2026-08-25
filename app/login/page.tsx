"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // proxy.ts only sets ?next= when it turned someone away from a page they asked for, so
  // its presence means "you were signed in a moment ago, and now you are not". Without
  // saying so, an expired session looks exactly like a broken app: the map they expected
  // is replaced by a form, with no clue why.
  const bounced = !!params.get("next");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "ورود ناموفق بود");
        setLoading(false);
        return;
      }
      router.push(params.get("next") || "/");
      router.refresh();
    } catch {
      setError("خطا در ارتباط با سرور");
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg p-4">
      {/* faint radar grid, ambient only -- never over content */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          maskImage: "radial-gradient(circle at center, black, transparent 75%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 aspect-square w-[140vmax] -translate-x-1/2 -translate-y-1/2 opacity-[0.12]"
        style={{
          background:
            "conic-gradient(from 0deg, var(--accent), transparent 22%, transparent)",
          animation: "spin var(--sweep-duration) linear infinite",
        }}
      />

      <form
        onSubmit={onSubmit}
        className="relative w-full max-w-sm rounded-lg border border-border bg-surface-raised p-8 elevate-accent"
      >
        <div className="mb-1 font-mono text-xs tracking-[0.12em] text-accent uppercase">
          Coverage Map
        </div>
        <h1 className="mb-1 text-xl font-bold text-text">نقشه پوشش مشتریان</h1>
        <p className="mb-6 text-sm text-text-muted">
          با نام کاربری و رمز عبور خودتان وارد شوید.
        </p>

        {bounced && (
          <p
            role="status"
            className="mb-4 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn"
          >
            نشست شما پایان یافته است. برای ادامه دوباره وارد شوید.
          </p>
        )}

        <input
          type="text"
          autoFocus
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="نام کاربری"
          dir="ltr"
          className="mb-3 w-full rounded-md border border-border bg-surface px-4 py-2 text-left font-mono text-base text-text outline-none transition-[border-color,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-out)] placeholder:text-text-faint focus:border-accent focus:elevate-accent"
        />
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="رمز عبور"
          dir="ltr"
          className="mb-4 w-full rounded-md border border-border bg-surface px-4 py-2 text-left font-mono text-base text-text outline-none transition-[border-color,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-out)] placeholder:text-text-faint focus:border-accent focus:elevate-accent"
        />
        {error && <p className="mb-4 text-sm text-crit">{error}</p>}
        <button
          type="submit"
          disabled={loading || !username.trim() || !password}
          className="w-full cursor-pointer rounded-md border border-accent bg-accent py-2 font-medium text-[#04191c] transition-[filter,transform,opacity] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:enabled:scale-[1.03] hover:enabled:brightness-110 active:enabled:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "در حال ورود..." : "ورود"}
        </button>
        <p className="mt-4 text-center text-xs text-text-faint">
          حساب ندارید؟ از مدیر بخواهید برایتان بسازد.
        </p>
      </form>

      <style>{`@keyframes spin { to { transform: translate(-50%, -50%) rotate(360deg); } }`}</style>
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
