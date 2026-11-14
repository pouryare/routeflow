"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { GoButton } from "@/components/tapflow/Answer";
import { faNum, faToman } from "@/lib/format";
import type { WrapUp } from "@/lib/repo/wrapUp";

/** F74 on «امروز»: the loose ends of the day in one short list, then one tap to say the day is closed. A checklist, not a report. */
export default function WrapUpCard({ w }: { w: WrapUp }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function close() {
    setBusy(true);
    setFailed(false);
    const res = await fetch("/api/today/close", { method: "POST" }).catch(() => null);
    setBusy(false);
    if (res?.ok) router.refresh();
    else setFailed(true);
  }
  const nothing = w.drafts.length + w.overdueTasks.length + w.promisesDue.length === 0;
  return (
    <section className="card mb-3 flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" dir="rtl" data-tour="day-wrapup" aria-label="بستن روز">
      <h3 className="sechead__title m-0">بستن روز</h3>
      {w.closed ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--success)" }}>امروز را بستید. فردا موفق باشید.</p> : null}
      {nothing ? (
        <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">کار نیمه‌تمامی ندارید.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-[var(--space-2)] p-0 text-[length:var(--text-sm)]">
          {w.drafts.map((d) => (
            <li key={`d${d.id}`}><Link className="underline" href={`/sales/orders/${d.id}`}>پیش‌نویس {d.order_no}</Link> · {d.customer_name}</li>
          ))}
          {w.overdueTasks.map((t) => (
            <li key={`t${t.id}`}>{t.entity_type === "customer" && t.entity_id ? <Link className="underline" href={`/crm/${t.entity_id}`}>{t.title}</Link> : t.title}<span className="text-[var(--muted)]"> · موعدش گذشته</span></li>
          ))}
          {w.promisesDue.map((p) => (
            <li key={`p${p.customer_id}`}><Link className="underline" href={`/crm/${p.customer_id}`}>{p.customer_name}</Link> قول داده {faToman(p.amount_toman)} بدهد و هنوز نداده</li>
          ))}
        </ul>
      )}
      {w.tomorrow.length > 0 ? (
        <p className="m-0 text-[length:var(--text-xs)] text-[var(--muted)]">فردا اول: {w.tomorrow.map((t) => t.title).join(" · ")} ({faNum(w.tomorrow.length)} کار)</p>
      ) : null}
      {failed ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>ثبت نشد؛ دوباره تلاش کنید</p> : null}
      {w.closed ? null : <GoButton icon="check" isDisabled={busy} onPress={() => void close()}>روز را بستم</GoButton>}
    </section>
  );
}
