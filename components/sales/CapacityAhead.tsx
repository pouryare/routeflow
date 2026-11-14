import { faNum } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import { Icon } from "@/components/meridian/Icon";
import type { DayLoad } from "@/lib/capacityAhead";
import type { Absence } from "@/lib/repo/absences";
import { ABSENCE_LABEL } from "@/lib/repo/absences";
import DriverAvailability from "@/components/sales/DriverAvailability";

const TONE = { ok: "var(--success)", tight: "var(--warning)", over: "var(--danger)", nolimit: "var(--muted)" } as const;
const WORD = { ok: "جا هست", tight: "نزدیک ظرفیت", over: "بیشتر از ظرفیت", nolimit: "سقف خودروها ثبت نشده" } as const;

/** F81 + F25 on the routing page: the next days' confirmed demand against the vans that can run, and who is away. Warning only; nothing is moved. */
export default function CapacityAhead({ loads, drivers, away }: { loads: DayLoad[]; drivers: { id: number; name: string }[]; away: Absence[] }) {
  return (
    <section className="card flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" dir="rtl" data-tour="capacity-ahead" aria-label="ظرفیت روزهای آینده">
      <h2 className="sechead__title m-0">ظرفیت روزهای آینده</h2>
      <ul className="m-0 flex list-none flex-col gap-[var(--space-2)] p-0 text-[length:var(--text-sm)]">
        {loads.map((l) => (
          <li key={l.day} className="flex flex-col gap-[var(--space-1)] border-b border-[var(--border)] pb-[var(--space-2)] last:border-b-0">
            <span className="flex items-center justify-between gap-[var(--space-2)]">
              <b>{faJalaliDate(l.day)}</b>
              <span className="inline-flex items-center gap-[var(--space-1)]" style={{ color: TONE[l.status] }}>
                {l.status === "ok" ? <Icon name="check" size="sm" /> : <Icon name="warn" size="sm" />}
                {WORD[l.status]}
              </span>
            </span>
            <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
              {faNum(l.demand.stops)} ایستگاه · {faNum(Math.round(l.demand.weightKg))} کیلو · {faNum(l.vans)} خودرو آزاد{l.awayVans ? ` · ${faNum(l.awayVans)} خودرو بی‌راننده` : ""}
            </span>
            {l.why && l.status !== "ok" ? <span className="text-[length:var(--text-xs)]" style={{ color: TONE[l.status] }}>{l.why}</span> : null}
          </li>
        ))}
      </ul>
      <p className="m-0 text-[length:var(--text-xs)] text-[var(--muted)]">فقط سفارش‌هایی که روز تحویل دارند شمرده می‌شوند. چیزی خودکار جابه‌جا نمی‌شود.</p>
      <DriverAvailability days={loads.map((l) => l.day)} drivers={drivers} away={away.map((a) => ({ ...a, label: ABSENCE_LABEL[a.kind] }))} />
    </section>
  );
}
