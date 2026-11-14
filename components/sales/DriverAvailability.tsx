"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BottomSheet from "@/components/mobile/BottomSheet";
import SmartPicker from "@/components/mobile/SmartPicker";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import { GoButton } from "@/components/tapflow/Answer";
import { Icon } from "@/components/meridian/Icon";
import { faJalaliDate } from "@/lib/jalali";
import { friendlyError } from "@/lib/userMessage";

const BTN = "inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-4)] text-[length:var(--text-sm)]";
const KINDS = [{ id: "leave", label: "مرخصی" }, { id: "sick", label: "بیماری" }, { id: "off", label: "روز استراحت" }];

/** F25: who is away on the coming days. Tap «راننده نیست» to mark one, the × to take it off. */
export default function DriverAvailability({ days, drivers, away }: { days: string[]; drivers: { id: number; name: string }[]; away: { user_id: number; day: string; label: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [driver, setDriver] = useState("");
  const [day, setDay] = useState(days[0] ?? "");
  const [kind, setKind] = useState("leave");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameOf = (id: number) => drivers.find((d) => d.id === id)?.name ?? "—";

  async function call(method: "POST" | "DELETE", body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/sales/absences", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const j = ((await res?.json().catch(() => ({}))) ?? {}) as { error?: string };
    setBusy(false);
    if (!res?.ok) { setError(friendlyError(j.error, "انجام نشد؛ دوباره تلاش کنید")); return false; }
    router.refresh();
    return true;
  }

  return (
    <div className="flex flex-col gap-[var(--space-2)]" data-tour="driver-away">
      <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)]">
        <b className="text-[length:var(--text-sm)]">راننده‌هایی که نیستند</b>
        {drivers.length > 0 ? <button type="button" className={BTN} onClick={() => setOpen(true)}><Icon name="plus" size="md" />راننده نیست</button> : null}
      </div>
      {away.length === 0 ? <p className="m-0 text-[length:var(--text-xs)] text-[var(--muted)]">برای این روزها همهٔ راننده‌ها هستند.</p> : (
        <ul className="m-0 flex list-none flex-col gap-[var(--space-1)] p-0 text-[length:var(--text-sm)]">
          {away.map((a) => (
            <li key={`${a.user_id}-${a.day}`} className="flex items-center justify-between gap-[var(--space-2)]">
              <span>{nameOf(a.user_id)} · {faJalaliDate(a.day)} · {a.label}</span>
              <button type="button" className="min-h-[44px] min-w-[44px] text-[var(--danger)]" aria-label="برداشتن" onClick={() => void call("DELETE", { user_id: a.user_id, day: a.day })}><Icon name="x" size="sm" /></button>
            </li>
          ))}
        </ul>
      )}
      {open ? (
        <BottomSheet open title="راننده نیست" onClose={() => setOpen(false)} closeLabel="بستن">
          <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
            <SmartPicker scope="drivers" label="راننده" items={drivers.map((d) => ({ id: String(d.id), label: d.name }))} value={driver} onChange={setDriver} placeholder="انتخاب کنید…" />
            <ChipGroup wrap group={{ id: "away-day", label: "روز", mode: "single", value: day, onChange: (v) => setDay(v as string), options: days.map((d) => ({ id: d, label: faJalaliDate(d) })) }} />
            <ChipGroup wrap group={{ id: "away-kind", label: "چرا", mode: "single", value: kind, onChange: (v) => setKind(v as string), options: KINDS }} />
            {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
            <GoButton icon="check" isDisabled={busy || !driver || !day} onPress={async () => { if (await call("POST", { user_id: Number(driver), day, kind })) { setOpen(false); setDriver(""); } }}>ثبت</GoButton>
          </div>
        </BottomSheet>
      ) : null}
    </div>
  );
}
