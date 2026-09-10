import Avatar from "@/components/meridian/Avatar";
import SectionHead from "@/components/meridian/SectionHead";
import { faNum } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import type { Streak } from "@/lib/streak";

const WEEKDAY = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];

/** «کارکرد رانندگان» on /sales/runs (item 14, `stats-activity-streak`).
 *
 *  The user asked why a driver had no face on this page. The avatar is added, but the
 *  substance is the grid beside it: one cell per day for the last twelve weeks, shaded by
 *  how many stops that driver delivered, the Persian week down the side. It answers "who
 *  is actually on the road" at a glance, which a name on a row never could.
 *
 *  Server component; the page hands over people already scoped to the viewer's groups. */
export default function DriverStreaks({
  people,
}: {
  people: { id: number; name: string; streak: Streak }[];
}) {
  if (people.length === 0) return null;
  return (
    <section
      aria-labelledby="streaks-heading"
      className="rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]"
    >
      <SectionHead
        id="streaks-heading"
        title="کارکرد رانندگان"
        sub="هر خانه یک روز از دوازده هفتهٔ گذشته است؛ پررنگ‌تر یعنی ایستگاه‌های تحویل‌شدهٔ بیشتر."
      />
      <ul className="streaks">
        {people.map((p) => (
          <li key={p.id} className="streaks__row">
            <div className="streaks__who">
              <Avatar userId={p.id} name={p.name} size={34} />
              <span className="streaks__text">
                <span className="streaks__name">{p.name}</span>
                <span className="streaks__meta">
                  {p.streak.activeDays > 0
                    ? `${faNum(p.streak.activeDays)} روز کاری · ${faNum(p.streak.total)} ایستگاه`
                    : "در این دوازده هفته تحویلی ثبت نشده"}
                </span>
                {p.streak.longest > 0 ? (
                  <span className="streaks__meta">
                    پشت‌سرهم اکنون {faNum(p.streak.current)} روز · بیشترین {faNum(p.streak.longest)} روز
                  </span>
                ) : null}
              </span>
            </div>
            <div
              className="streak"
              role="img"
              aria-label={`${p.name}: ${faNum(p.streak.activeDays)} روز کاری در دوازده هفته`}
            >
              <span className="streak__days" aria-hidden="true">
                {WEEKDAY.map((d, i) => (
                  <span key={d}>{i % 2 === 0 ? d.slice(0, 1) : ""}</span>
                ))}
              </span>
              {p.streak.weeks.map((week) => (
                <span key={week[0].date} className="streak__week" aria-hidden="true">
                  {week.map((c) => (
                    <span
                      key={c.date}
                      className={`streak__cell streak__cell--${c.future ? "future" : c.level}`}
                      title={c.future ? undefined : `${faJalaliDate(c.date)} · ${faNum(c.n)} ایستگاه`}
                    />
                  ))}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
