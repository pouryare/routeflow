"use client";

import { toNumber } from "@/lib/money";
import { useState } from "react";
import { useRouter } from "next/navigation";
import KeypadField from "@/components/mobile/KeypadField";
import StickyAction from "@/components/mobile/StickyAction";
import type { DiscountSettings } from "@/lib/repo/discounts";

/** The two company discount settings, each a keypad field; one save bar at the bottom. */
export default function DiscountSettingsForm({ initial }: { initial: DiscountSettings }) {
  const router = useRouter();
  const [auto, setAuto] = useState(String(initial.auto_pass_pct));
  const [commission, setCommission] = useState(String(initial.commission_pct));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = toNumber(auto) !== initial.auto_pass_pct || toNumber(commission) !== initial.commission_pct;

  const save = async () => {
    const autoPct = auto.trim() === "" ? 0 : toNumber(auto);
    const commissionPct = commission.trim() === "" ? 0 : toNumber(commission);
    if (autoPct === null || commissionPct === null) {
      setMsg({ ok: false, text: "مقدار نامعتبر است" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/discount-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto_pass_pct: autoPct, commission_pct: commissionPct }),
      });
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      if (res.ok) {
        setMsg({ ok: true, text: "ذخیره شد" });
        router.refresh();
      } else setMsg({ ok: false, text: j?.error ?? "ذخیره نشد؛ دوباره تلاش کنید" });
    } catch {
      setMsg({ ok: false, text: "ذخیره نشد؛ دوباره تلاش کنید" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="card flex flex-col gap-[var(--space-4)] p-[var(--space-4)]" dir="rtl">
        <span className="text-[length:var(--text-sm)] font-medium">تخفیف بدون نیاز به تأیید تا</span>
        <KeypadField label="تخفیف بدون نیاز به تأیید تا" value={auto} onChange={setAuto} unit="٪" decimal />
        <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">
          تخفیفِ کمتر از این درصد خودکار تأیید می‌شود. صفر یعنی هر تخفیف منتظر تأیید می‌ماند.
        </p>
        <span className="text-[length:var(--text-sm)] font-medium">سهم کمیسیون از تخفیف</span>
        <KeypadField label="سهم کمیسیون از تخفیف" value={commission} onChange={setCommission} unit="٪" decimal />
        <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">
          چند درصدِ تخفیفِ تأییدشده از کمیسیون افراد انتخاب‌شده کم شود. بقیه را شرکت می‌پذیرد.
        </p>
        {msg && (
          <p role="status" className="m-0 text-[length:var(--text-sm)]" style={{ color: msg.ok ? "var(--good)" : "var(--crit)" }}>
            {msg.text}
          </p>
        )}
      </section>
      <div className="sticky-action-gap" aria-hidden />
      <StickyAction icon="save" label="ذخیرهٔ تنظیمات" busy={busy ? "در حال ذخیره…" : undefined} onClick={save} disabled={busy || !dirty} />
    </>
  );
}
