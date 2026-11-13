"use client";

import { useState } from "react";
import { faJalaliDate } from "@/lib/jalali";
import { useRouter } from "next/navigation";
import BottomSheet from "@/components/mobile/BottomSheet";
import KeypadField from "@/components/mobile/KeypadField";
import { GoButton } from "@/components/tapflow/Answer";
import { Icon } from "@/components/meridian/Icon";
import { friendlyError } from "@/lib/userMessage";
import { faNum } from "@/lib/format";
import { toNumber } from "@/lib/money";
import type { RuleFiring, RuleOverview } from "@/lib/repo/rules";

const ACTION = { task: "کار", alert: "هشدار", notify: "اعلان" } as const;
const TRIGGER = { event: "با رویداد", sweep: "بررسی دوره‌ای" } as const;

/** F130 «قانون‌ها»: switch a rule off or on, change its waiting time and its daily cap, and read its firing log.
 *  A rule that is off makes nothing new; one that reached its daily cap makes nothing more until tomorrow. */
export default function RulesList({ rules }: { rules: RuleOverview[] }) {
  const router = useRouter();
  const [edit, setEdit] = useState<RuleOverview | null>(null);
  const [minutes, setMinutes] = useState("");
  const [budget, setBudget] = useState("");
  const [log, setLog] = useState<{ rule: RuleOverview; rows: RuleFiring[] | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function patch(code: string, body: { active?: boolean; cooldown_min?: number; daily_budget?: number | null }): Promise<boolean> {
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

  async function openLog(rule: RuleOverview) {
    setLog({ rule, rows: null });
    const res = await fetch(`/api/rules/firings?code=${encodeURIComponent(rule.code)}`).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { firings?: RuleFiring[] } | null;
    setLog({ rule, rows: j?.firings ?? [] });
  }

  const m = toNumber(minutes);
  const b = toNumber(budget);
  const budgetOk = budget.trim() === "" || (b !== null && Number.isInteger(b) && b >= 1 && b <= 100000);
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
            <button type="button" onClick={() => { setEdit(r); setMinutes(String(r.cooldownMin)); setBudget(r.dailyBudget ? String(r.dailyBudget) : ""); setError(null); }} className="inline-flex min-h-[44px] items-center gap-[var(--space-2)] self-start rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] text-[length:var(--text-sm)]">
              <Icon name="clock" size="md" />
              تنظیم: انتظار {faNum(r.cooldownMin)} دقیقه · {r.dailyBudget ? `سقف ${faNum(r.dailyBudget)} در روز` : "بدون سقف روزانه"}
            </button>
            <button type="button" onClick={() => void openLog(r)} className="inline-flex min-h-[44px] items-center gap-[var(--space-2)] self-start rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] text-[length:var(--text-sm)]">
              <Icon name="list" size="md" />
              سابقهٔ اجرا
            </button>
          </li>
        ))}
      </ul>
      {error && !edit ? <p className="m-0 mt-[var(--space-2)] text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
      {edit ? (
        <BottomSheet open title="تنظیم قانون" subtitle={edit.name} onClose={() => setEdit(null)} closeLabel="بستن تنظیم قانون">
          <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
            <KeypadField label="دقیقه" value={minutes} onChange={setMinutes} unit="دقیقه" />
            <p className="m-0 text-[length:var(--text-xs)] text-[var(--muted)]">بعد از ساخته‌شدن برای یک مورد، تا این مدت دوباره برای همان مورد نمی‌سازد.</p>
            <KeypadField label="سقف در روز (خالی = بدون سقف)" value={budget} onChange={setBudget} unit="بار" />
            <p className="m-0 text-[length:var(--text-xs)] text-[var(--muted)]">اگر امروز به این تعداد ساخته شد، تا فردا چیز تازه‌ای نمی‌سازد؛ برای جلوگیری از سیل کار و هشدار.</p>
            {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
            <GoButton icon="save" isDisabled={busy !== null || m === null || !Number.isInteger(m) || m < 1 || m > 43200 || !budgetOk} onPress={() => void patch(edit.code, { cooldown_min: m as number, daily_budget: budget.trim() === "" ? null : (b as number) }).then((ok) => { if (ok) setEdit(null); })}>ذخیرهٔ تنظیم</GoButton>
          </div>
        </BottomSheet>
      ) : null}
      {log ? (
        <BottomSheet open title="سابقهٔ اجرا" subtitle={log.rule.name} onClose={() => setLog(null)} closeLabel="بستن سابقهٔ اجرا">
          <div className="flex flex-col gap-[var(--space-2)]" dir="rtl">
            {log.rows === null ? <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">در حال بارگذاری…</p> : log.rows.length === 0 ? <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">این قانون هنوز اجرا نشده است.</p> : (
              <ul className="m-0 flex list-none flex-col gap-[var(--space-2)] p-0 text-[length:var(--text-sm)]">
                {log.rows.map((f, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-[var(--space-2)] border-b border-[var(--border)] pb-[var(--space-2)]">
                    <span>{f.title}</span>
                    <span className="tnum text-[var(--muted)]">{faJalaliDate(f.firedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </BottomSheet>
      ) : null}
    </div>
  );
}
