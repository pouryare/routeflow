import { faNum } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import type { MileageDay, MileagePerson } from "@/lib/repo/mileage";

/** F103: the distance between a person's visits, estimated from the shops' places in time order. A reader's own days, and for a
 *  manager everyone's month. An estimate, not an odometer: it says so. */
export default function MileageCard({ mine, team }: { mine: MileageDay[]; team: MileagePerson[] }) {
  const total = Math.round(mine.reduce((s, d) => s + d.km, 0) * 10) / 10;
  return (
    <section className="card flex flex-col gap-[var(--space-2)] p-[var(--space-4)]" dir="rtl" data-tour="mileage" aria-label="مسافت کاری">
      <h3 className="sechead__title m-0">مسافت کاری این ماه</h3>
      {mine.length === 0 ? (
        <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">بازدیدی با مکان مشخص ثبت نشده.</p>
      ) : (
        <>
          <p className="m-0 text-[length:var(--text-sm)]"><b>{faNum(total)} کیلومتر</b> در {faNum(mine.length)} روز</p>
          <ul className="m-0 flex list-none flex-col gap-[var(--space-1)] p-0 text-[length:var(--text-xs)] text-[var(--muted)]">
            {mine.slice(0, 10).map((d) => <li key={d.day}>{faJalaliDate(d.day)}: {faNum(d.visits)} بازدید · {faNum(d.km)} کیلومتر</li>)}
          </ul>
        </>
      )}
      {team.length > 0 ? (
        <>
          <h4 className="m-0 mt-[var(--space-2)] text-[length:var(--text-sm)]">همکاران این ماه</h4>
          <ul className="m-0 flex list-none flex-col gap-[var(--space-1)] p-0 text-[length:var(--text-sm)]">
            {team.map((p) => <li key={p.user_id}>{p.name}: {faNum(p.km)} کیلومتر در {faNum(p.visits)} بازدید</li>)}
          </ul>
        </>
      ) : null}
      <p className="m-0 text-[length:var(--text-xs)] text-[var(--muted)]">تخمین است: فاصلهٔ مغازه‌ها به ترتیب بازدید، با ضریب ۱٫۳ برای خیابان‌ها. کیلومترشمار نیست.</p>
    </section>
  );
}
