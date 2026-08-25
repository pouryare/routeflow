"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<"shared" | "account">("shared");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [name, setName] = useState(() =>
    typeof window === "undefined" ? "" : (localStorage.getItem("coverage_actor_name") ?? "")
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "shared" && name.trim()) localStorage.setItem("coverage_actor_name", name.trim());
      const body =
        mode === "account"
          ? { username: username.trim(), password }
          : { password, name: name.trim() || undefined };
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "ورود ناموفق بود");
        setLoading(false);
        return;
      }
      // Drives the standing banner in the app shell. Set or cleared on every successful
      // login, so signing in as a real account is what makes the warning go away.
      try {
        if (data.shared_password_login) sessionStorage.setItem("shared_login", "1");
        else sessionStorage.removeItem("shared_login");
      } catch {
        // Storage unavailable; the banner just will not show.
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
          {mode === "shared" ? "برای ورود، رمز عبور را وارد کنید." : "با نام کاربری و رمز عبور خودتان وارد شوید."}
        </p>

        {mode === "account" ? (
          <input
            type="text"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="نام کاربری"
            className="mb-3 w-full rounded-md border border-border bg-surface px-4 py-2 text-right text-base text-text outline-none transition-[border-color,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-out)] placeholder:text-text-faint focus:border-accent focus:elevate-accent"
          />
        ) : (
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="نام شما (اختیاری -- برای تاریخچه تغییرات)"
            className="mb-3 w-full rounded-md border border-border bg-surface px-4 py-2 text-right text-base text-text outline-none transition-[border-color,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-out)] placeholder:text-text-faint focus:border-accent focus:elevate-accent"
          />
        )}
        <input
          type="password"
          autoFocus={mode === "shared"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="رمز عبور"
          className="mb-4 w-full rounded-md border border-border bg-surface px-4 py-2 text-right font-mono text-base text-text outline-none transition-[border-color,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-out)] placeholder:text-text-faint focus:border-accent focus:elevate-accent"
        />
        {error && <p className="mb-4 text-sm text-crit">{error}</p>}
        <button
          type="submit"
          disabled={loading || !password || (mode === "account" && !username.trim())}
          className="w-full cursor-pointer rounded-md border border-accent bg-accent py-2 font-medium text-[#04191c] transition-[filter,transform,opacity] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:enabled:scale-[1.03] hover:enabled:brightness-110 active:enabled:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "در حال ورود..." : "ورود"}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode((m) => (m === "shared" ? "account" : "shared"));
            setError(null);
          }}
          className="mt-3 w-full text-center text-xs text-text-faint transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-accent"
        >
          {mode === "shared" ? "ورود با حساب کاربری شخصی" : "ورود با رمز مشترک"}
        </button>
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
