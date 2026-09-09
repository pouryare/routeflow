"use client";

import { useMemo, useState } from "react";
import { faNum } from "@/lib/format";
import { faJalaliDate, jalaliToIsoDate, JALALI_MONTHS } from "@/lib/jalali";
import { tripPurpose } from "@/lib/tripPurpose";
import { Icon } from "@/components/meridian/Icon";

export interface ScheduleRun {
  id: number;
  run_date: string;
  status: string;
  driver: string;
  stops: number;
}

export interface ScheduleVisit {
  id: number;
  planned_date: string;
  status: string;
  purpose: string | null;
  who: string;
  where_: string | null;
}

/** The month grid plus the day rail — one client component because picking a day on
 *  the calendar has to change what the rail shows. They used to be split across the
 *  server page (which only ever rendered today) and this file (which only tracked a
 *  `sel` class nobody read), so clicking a day repainted the button and nothing else. */
export default function ScheduleBoard({
  jy,
  jm,
  today,
  leadingBlanks,
  days,
  runs,
  visits,
  marks,
}: {
  jy: number;
  jm: number;
  /** Day-of-month that is today. */
  today: number;
  /** Blank cells before day 1, so the week actually aligns. */
  leadingBlanks: number;
  /** Real day count for this month (29–31), not a hardcoded 31. */
  days: number;
  runs: ScheduleRun[];
  visits: ScheduleVisit[];
  /** Day-of-month → dot colours, precomputed once for the whole month. */
  marks: Record<number, string[]>;
}) {
  const [sel, setSel] = useState(today);
  const selIso = jalaliToIsoDate(jy, jm, sel);

  const visitsForDay = useMemo(() => visits.filter((v) => v.planned_date === selIso), [visits, selIso]);
  const runsForDay = useMemo(() => runs.filter((r) => r.run_date === selIso), [runs, selIso]);

  const dow = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

  return (
    <div className="sched">
      <div className="kblock">
        <div className="bhead">
          <div>
            <h2>
              {JALALI_MONTHS[jm - 1]} {faNum(jy)}
            </h2>
            <div className="n">نقطه‌ها یعنی آن روز مسیری ثبت شده</div>
          </div>
        </div>
        <div className="cal">
          <div className="calgrid">
            {dow.map((d) => (
              <div className="dow" key={d}>
                {d}
              </div>
            ))}
            {Array.from({ length: leadingBlanks }, (_, i) => (
              <div className="day out" key={`b${i}`} aria-hidden />
            ))}
            {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
              <button
                key={d}
                type="button"
                className={`day${d === today ? " today" : ""}${sel === d && d !== today ? " sel" : ""}`}
                onClick={() => setSel(d)}
                aria-current={d === today ? "date" : undefined}
                aria-pressed={sel === d}
              >
                <span>{faNum(d)}</span>
                <span className="dots">
                  {(marks[d] ?? []).slice(0, 3).map((c, k) => (
                    <i key={k} style={{ background: c }} />
                  ))}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="kblock">
        <div className="bhead">
          <div>
            <h2>
              {faJalaliDate(selIso)}
              {sel === today ? " · امروز" : ""}
            </h2>
            <div className="n">
              {faNum(visitsForDay.length)} ویزیت · {faNum(runsForDay.length)} مسیر تحویل
            </div>
          </div>
        </div>
        <div className="rail">
          {visitsForDay.length === 0 && runsForDay.length === 0 ? (
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 13.5 }}>
              برای این روز نه ویزیتی برنامه‌ریزی شده و نه مسیری در دفتر است.
            </p>
          ) : (
            <>
              {visitsForDay.map((v) => {
                const p = tripPurpose(v.purpose);
                return (
                  <div className="slot" key={`v${v.id}`}>
                    <div className="h">{p ? <Icon name={p.icon} size="sm" /> : "•"}</div>
                    <div className="lane">
                      <div
                        className="ev"
                        style={{
                          background: p?.soft ?? "var(--sunk)",
                          color: p?.ink ?? "var(--muted)",
                        }}
                      >
                        <span
                          className="dot"
                          style={{ background: "color-mix(in srgb, currentColor 16%, transparent)" }}
                        >
                          {p ? <Icon name={p.icon} size="sm" /> : "•"}
                        </span>
                        <div>
                          <div className="t">{v.who}</div>
                          <div className="s">
                            {p ? p.label : "بدون هدف"}
                            {v.where_ ? ` · ${v.where_}` : ""}
                            {v.status === "done" ? " · انجام شد" : v.status === "skipped" ? " · رد شد" : ""}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {runsForDay.map((r) => (
                <div className="slot" key={`r${r.id}`}>
                  <div className="h">
                      <Icon name="truck" size="sm" />
                    </div>
                  <div className="lane">
                    <div className="ev a">
                      <span className="dot">
                        <Icon name="truck" size="sm" />
                      </span>
                      <div>
                        <div className="t">مسیر {r.driver}</div>
                        <div className="s">
                          {faNum(r.stops)} توقف ·{" "}
                          {r.status === "done"
                            ? "تمام شد"
                            : r.status === "in_progress"
                              ? "در حال اجرا"
                              : "برنامه‌ریزی‌شده"}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
