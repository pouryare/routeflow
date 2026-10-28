"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import BottomSheet from "@/components/mobile/BottomSheet";
import HoldButton from "@/components/mobile/HoldButton";
import OtpInput from "@/components/mobile/OtpInput";
import { GoButton } from "@/components/tapflow/Answer";

interface Ask {
  label: string;
  critical: boolean;
}

const VERIFY_URL = "/api/me/step-up";

/** Sensitive actions answer 403 with a `step_up` object until the person has entered their
 *  authenticator code (lib/stepUp.ts). This patches `fetch` for the whole shell: on such an answer it
 *  opens one sheet for the code, then repeats the request that was refused, so no screen needs its own
 *  code step. Closing the sheet leaves the original refusal in place, which every screen already shows. */
export default function StepUpProvider() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const waiting = useRef<((ok: boolean) => void) | null>(null);
  const pending = useRef<Promise<boolean> | null>(null);

  const close = useCallback((ok: boolean) => {
    waiting.current?.(ok);
    waiting.current = null;
    pending.current = null;
    setAsk(null);
    setCode("");
    setError(null);
  }, []);

  useEffect(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const again = input instanceof Request ? input.clone() : null;
      const res = await original(input, init);
      if (res.status !== 403) return res;
      const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
      if (url.includes(VERIFY_URL)) return res;
      const info = ((await res.clone().json().catch(() => null)) as { step_up?: { method?: string; label?: string; critical?: boolean } } | null)?.step_up;
      if (!info || info.method !== "totp") return res;
      // Two refused requests at once share one sheet.
      pending.current ??= new Promise<boolean>((resolve) => {
        waiting.current = resolve;
        setAsk({ label: info.label ?? "این کار", critical: !!info.critical });
      });
      return (await pending.current) ? original(again ?? input, init) : res;
    };
    return () => {
      window.fetch = original;
    };
  }, []);

  async function verify(value: string) {
    if (busy || value.length < 6) return;
    setBusy(true);
    setError(null);
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: value }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    setBusy(false);
    if (data?.ok) close(true);
    else {
      setError(data?.error ?? "انجام نشد؛ دوباره تلاش کنید");
      setCode("");
    }
  }

  return (
    <BottomSheet
      open={ask !== null}
      title="کد برنامهٔ احراز هویت"
      subtitle={ask?.label}
      onClose={() => close(false)}
      closeLabel="بستن پنجرهٔ کد"
      live
    >
      <div className="flex flex-col gap-[var(--space-4)] pb-[var(--space-4)]" dir="rtl">
        <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">
          برای این کار کد ۶ رقمی برنامهٔ احراز هویت (مثل Google Authenticator) را وارد کنید. بعد از آن ۱۰ دقیقه روی همین دستگاه دوباره پرسیده نمی‌شود.
        </p>
        <OtpInput value={code} onChange={setCode} onComplete={(v) => void verify(v)} isInvalid={error !== null} disabled={busy} />
        {error && <p role="alert" className="m-0 text-center text-[length:var(--text-sm)] text-[var(--crit)]">{error}</p>}
        {ask?.critical ? (
          <HoldButton onConfirm={() => void verify(code)} disabled={busy || code.length < 6}>
            تأیید و انجام
          </HoldButton>
        ) : (
          <GoButton icon="check" onPress={() => void verify(code)} isDisabled={busy || code.length < 6}>
            {busy ? "در حال بررسی…" : "تأیید و انجام"}
          </GoButton>
        )}
      </div>
    </BottomSheet>
  );
}
