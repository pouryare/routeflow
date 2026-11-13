"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BottomSheet from "@/components/mobile/BottomSheet";
import KeypadField from "@/components/mobile/KeypadField";
import { GoButton } from "@/components/tapflow/Answer";
import { Icon } from "@/components/meridian/Icon";
import { friendlyError } from "@/lib/userMessage";
import { faNum } from "@/lib/format";
import { toNumber } from "@/lib/money";
import type { RuleOverview } from "@/lib/repo/rules";

const ACTION = { task: "کار", alert: "هشدار", notify: "اعلان" } as const;
const TRIGGER = { event: "با رویداد", sweep: "بررسی دوره‌ای" } as const;

/** F130 «قانون‌ها»: switch a rule off or on and change its waiting time. A rule that is off makes nothing new. */
export default function RulesList({ rules }: { rules: RuleOverview[] }) {
  const router = useRouter();
  const [edit, setEdit] = useState<RuleOverview | null>(null);
  const [minutes, setMinutes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function patch(code: string, body: { active?: boolean; cooldown_min?: number }): Promise<boolean> {
    setBusy(code);
    setError(null);
    const res = await fetch("/api/rules", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, ...body }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(null);
    if (res?.ok) {
      router.refresh();
      return true;
    }
    setError(friendlyError(j?.error, "ذخیره نشد؛ دوباره تلاش کنید"));
    return false;
  }

  const m = toNumber(minutes);
  return (
    <div dir="rtl" data-tour="rules">
      <ul className="m-0 flex list-none flex-col gap-[var(--space-3)] p-0">
        {rules.map((r) => (
          <li key={r.code} className="card flex flex-col gap-[var(--space-2)] p-[var(--space-3)]" style={r.active ? undefined : { opacity: 0.6 }}>
            <div className="flex items-center justify-between gap-[var(--space-3)]">
              <span className="font-medium">{r.name}</span>
              <button type="button" role="switch" aria-checked={r.active} aria-label={`${r.active ? "خاموش کردن" : "روشن کردن"} ${r.name}`} disabled={busy === r.code} onClick={() => void patch(r.code, { active: !r.active })} className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-[var(--space-1)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] text-[length:var(--text-sm)]">
                <Icon name={r.active ? "check" : "x"} size="md" />
                {r.active ? "روشن" : "خاموش"}
              </button>
            </div>
            <p className="m-0 text-[length:var(--text-xs)] text-[var(--muted)]">
              {ACTION[r.action]} · {TRIGGER[r.trigger]} · {faNum(r.fired14)} اجرا در ۱۴ روز
            </p>
            <button type="button" onClick={() => { setEdit(r); setMinutes(String(r.cooldownMin)); setError(null); }} className="inline-flex min-h-[44px] items-center gap-[var(--space-2)] self-start rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] text-[length:var(--text-sm)]">
              <Icon name="clock" size="md" />
              زمان انتظار: {faNum(r.cooldownMin)} دقیقه
            </button>
          </li>
        ))}
      </ul>
      {error && !edit ? <p className="m-0 mt-[var(--space-2)] text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
      {edit ? (
        <BottomSheet open title="زمان انتظار" subtitle={edit.name} onClose={() => setEdit(null)} closeLabel="بستن زمان انتظار">
          <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
            <KeypadField label="دقیقه" value={minutes} onChange={setMinutes} unit="دقیقه" />
            <p className="m-0 text-[length:var(--text-xs)] text-[var(--muted)]">بعد از ساخته‌شدن برای یک مورد، تا این مدت دوباره برای همان مورد نمی‌سازد.</p>
            {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
            <GoButton icon="save" isDisabled={busy !== null || m === null || !Number.isInteger(m) || m < 1 || m > 43200} onPress={() => void patch(edit.code, { cooldown_min: m as number }).then((ok) => { if (ok) setEdit(null); })}>ذخیرهٔ زمان</GoButton>
          </div>
        </BottomSheet>
      ) : null}
    </div>
  );
}
