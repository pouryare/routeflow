"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import { faNum } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";

interface Person { id: number; display_name: string }
interface Away { id: number; display_name: string; leave_until: string; leave_reason: string | null; customers: number; tasks: number }

const DAYS = [
  { id: "1", label: "امروز" },
  { id: "3", label: "۳ روز" },
  { id: "7", label: "یک هفته" },
  { id: "14", label: "دو هفته" },
  { id: "30", label: "یک ماه" },
];
const REASONS = ["مرخصی", "بیماری", "ماموریت", "سفر"];

async function call(url: string, init?: RequestInit) {
  const res = await fetch(url, init).catch(() => null);
  const j = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string; people?: Away[] } | null;
  return { ok: Boolean(res?.ok && j?.ok), error: j?.error ?? (res ? undefined : "ارتباط برقرار نشد"), people: j?.people ?? [] };
}

/** S23: who is away, until when, and what they still hold. A manager sends someone on leave with a length and a
 *  reason, and sees the cover that is missing (customers and open tasks still on a person who is away) with a
 *  pointer to the handover card below. People on leave are not offered new customers. */
export default function LeaveCard({ people }: { people: Person[] }) {
  const [away, setAway] = useState<Away[]>([]);
  const [who, setWho] = useState("");
  const [days, setDays] = useState("7");
  const [reason, setReason] = useState("مرخصی");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const r = await call("/api/admin/leave");
    if (r.ok) setAway(r.people);
  }, []);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function send(userId: number, d: number | null) {
    setBusy(true); setMsg("");
    const r = await call("/api/admin/leave", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: userId, days: d, reason }) });
    setBusy(false);
    if (!r.ok) { setMsg(r.error ?? "ثبت نشد"); return; }
    setWho("");
    await load();
  }

  const onLeave = new Set(away.map((a) => a.id));
  return (
    <section className="rounded-lg border border-border bg-surface p-4" aria-labelledby="leave-title" data-tour="leave">
      <h2 id="leave-title" className="sechead__title mb-1">مرخصی همکاران</h2>
      <p className="mb-3 text-sm text-text-muted">کسی که مرخصی است، مشتری تازه‌ای به او پیشنهاد نمی‌شود. کارهایی که هنوز دست اوست را از «واگذاری» پایین صفحه به همکار دیگر بسپارید.</p>

      {away.length > 0 && (
        <ul className="mb-4 flex flex-col gap-2">
          {away.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3">
              <div>
                <p className="font-medium">{a.display_name}</p>
                <p className="text-sm text-text-muted">{a.leave_reason ? `${a.leave_reason} · ` : ""}تا {faJalaliDate(a.leave_until)}</p>
                {a.customers + a.tasks > 0 && <p className="text-sm text-warn">هنوز {faNum(a.customers)} مشتری و {faNum(a.tasks)} کار باز دست اوست</p>}
              </div>
              <button type="button" disabled={busy} onClick={() => void send(a.id, null)} className="btn min-h-[44px] inline-flex items-center gap-[var(--space-2)]">
                <Icon name="check" size="md" /> برگشت به کار
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="mb-1 text-sm">چه کسی مرخصی است؟</p>
      <ChipGroup wrap group={{ id: "leave-who", label: "چه کسی", mode: "single", value: who, options: people.filter((p) => !onLeave.has(p.id)).map((p) => ({ id: String(p.id), label: p.display_name })), onChange: (v) => setWho(v as string) }} />
      {who && (
        <>
          <p className="mb-1 mt-3 text-sm">تا چند روز؟</p>
          <ChipGroup wrap group={{ id: "leave-days", label: "مدت", mode: "single", value: days, options: DAYS, onChange: (v) => setDays((v as string) || days) }} />
          <p className="mb-1 mt-3 text-sm">دلیل</p>
          <ChipGroup wrap group={{ id: "leave-reason", label: "دلیل", mode: "single", value: reason, options: REASONS.map((r) => ({ id: r, label: r })), onChange: (v) => setReason(v as string) }} />
          <button type="button" disabled={busy} onClick={() => void send(Number(who), Number(days))} className="btn solid mt-3 inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)]">
            <Icon name="calendar" size="md" /> ثبت مرخصی
          </button>
        </>
      )}
      {msg && <p className="mt-3 text-sm" role="status">{msg}</p>}
    </section>
  );
}
