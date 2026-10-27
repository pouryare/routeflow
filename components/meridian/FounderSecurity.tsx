"use client";

import { FieldInput } from "@/components/FieldInput";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SectionHead from "@/components/meridian/SectionHead";
import { Icon } from "@/components/meridian/Icon";

type Status = { enabled: boolean; pending: boolean; recoveryLeft: number };

const BUTTON =
  "inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--accent)] px-[var(--space-4)] text-[length:var(--text-sm)] font-medium text-accent-ink disabled:opacity-50";
const GHOST =
  "inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-4)] text-[length:var(--text-sm)] text-[var(--text)] disabled:opacity-50";
const INPUT =
  "min-h-[44px] w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] text-center font-mono text-[length:var(--text-base)] tracking-[0.2em] text-[var(--text)]";

/** The founder's second login step (an authenticator-app code on top of the password). The account sees
 *  every company, so this is the main protection to add to it. Turning it off needs a current code, so a
 *  hijacked session cannot quietly remove it. Server-side rules live in lib/repo/secondFactor.ts. */
export default function FounderSecurity() {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/admin/second-factor")
      .then((r) => r.json())
      .then((d: Status & { ok?: boolean }) => d.ok && setStatus({ enabled: d.enabled, pending: d.pending, recoveryLeft: d.recoveryLeft }))
      .catch(() => setStatus(null));
  }, []);

  async function act(action: "begin" | "confirm" | "disable") {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/second-factor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, code }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string; secret?: string; uri?: string; recoveryCodes?: string[] } | null;
    setBusy(false);
    if (!data?.ok) {
      setError(data?.error ?? "انجام نشد؛ دوباره تلاش کنید");
      return;
    }
    setCode("");
    if (action === "begin" && data.secret && data.uri) setSetup({ secret: data.secret, uri: data.uri });
    if (action === "confirm") {
      setSetup(null);
      setRecovery(data.recoveryCodes ?? []);
      setStatus({ enabled: true, pending: false, recoveryLeft: data.recoveryCodes?.length ?? 0 });
    }
    if (action === "disable") setStatus({ enabled: false, pending: false, recoveryLeft: 0 });
    router.refresh();
  }

  if (!status) return null;

  return (
    <section className="mt-[var(--space-4)]" aria-label="ورود دومرحله‌ای">
      <SectionHead title="ورود دومرحله‌ای" />
      <p className="m-0 mt-[var(--space-1)] mb-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--text-muted)]">
        {status.enabled
          ? `فعال است. هر ورود علاوه بر رمز، کد برنامهٔ احراز هویت می‌خواهد. کدهای بازیابی باقی‌مانده: ${status.recoveryLeft}`
          : "غیرفعال است. این حساب همهٔ سازمان‌ها را می‌بیند؛ رمز تنها کافی نیست. فعال‌سازی را توصیه می‌کنیم."}
      </p>

      {recovery ? (
        <div role="status" className="rounded-[var(--radius-md)] border border-[var(--warn)]/40 bg-[var(--warn)]/10 p-[var(--space-3)]">
          <p className="m-0 mb-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--warn)]">
            این کدها فقط همین یک بار نمایش داده می‌شوند. جای امنی ذخیره‌شان کنید؛ هر کدام یک‌بار مصرف است.
          </p>
          <ul className="m-0 grid list-none grid-cols-2 gap-[var(--space-2)] p-0 font-mono text-[length:var(--text-base)]" dir="ltr">
            {recovery.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <button type="button" className={`${GHOST} mt-[var(--space-3)]`} onClick={() => setRecovery(null)}>
            <Icon name="check" size="md" />
            ذخیره کردم
          </button>
        </div>
      ) : setup ? (
        <div className="flex flex-col gap-[var(--space-2)]">
          <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">
            این کلید را در برنامهٔ احراز هویت (مثل Google Authenticator) وارد کنید، سپس کد ۶ رقمی را بنویسید.
          </p>
          <div dir="ltr" className="select-all break-all rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)] font-mono text-[length:var(--text-sm)]">
            {setup.secret}
          </div>
          <a href={setup.uri} className={GHOST}>
            <Icon name="link" size="md" />
            باز کردن در برنامه
          </a>
          <FieldInput type="text" inputMode="numeric" autoComplete="one-time-code" dir="ltr" placeholder="000000" value={code} onChange={(e) => setCode(e.target.value)} className={INPUT} aria-label="کد ۶ رقمی" />
          <button type="button" className={BUTTON} disabled={busy || !code.trim()} onClick={() => void act("confirm")}>
            <Icon name="check" size="md" />
            تأیید و فعال‌سازی
          </button>
        </div>
      ) : status.enabled ? (
        <div className="flex flex-col gap-[var(--space-2)]">
          <FieldInput type="text" inputMode="numeric" autoComplete="one-time-code" dir="ltr" placeholder="کد برای غیرفعال‌سازی" value={code} onChange={(e) => setCode(e.target.value)} className={INPUT} aria-label="کد فعلی" />
          <button type="button" className={GHOST} disabled={busy || !code.trim()} onClick={() => void act("disable")}>
            <Icon name="x" size="md" />
            غیرفعال کردن
          </button>
        </div>
      ) : (
        <button type="button" className={BUTTON} disabled={busy} onClick={() => void act("begin")}>
          <Icon name="user" size="md" />
          فعال‌سازی
        </button>
      )}
      {error ? <p className="mt-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--crit)]">{error}</p> : null}
    </section>
  );
}
