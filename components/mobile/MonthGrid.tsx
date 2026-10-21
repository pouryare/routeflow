"use client";

import { useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import { faNum } from "@/lib/format";
import { JALALI_WEEKDAYS, jalaliMonthGrid, shiftMonth, toJalali, tehranTodayIso } from "@/lib/jalali";

/** One Persian month as a grid of 44 px day buttons: tap a day to choose it. `marked` days (the
 *  ones already recorded) wear a dot, so the grid shows what exists as well as what is chosen.
 *  The ISO each cell returns is computed by `jalaliMonthGrid`; nothing here converts dates. */
export default function MonthGrid({
  value,
  onChange,
  marked = new Set<string>(),
  ariaLabel,
}: {
  value: string;
  onChange: (iso: string) => void;
  marked?: ReadonlySet<string>;
  ariaLabel: string;
}) {
  const start = toJalali(value || tehranTodayIso())!;
  const [ym, setYm] = useState({ jy: start.jy, jm: start.jm });
  const grid = jalaliMonthGrid(ym.jy, ym.jm);

  return (
    <div className="monthgrid" role="group" aria-label={ariaLabel}>
      <div className="monthgrid__head">
        <button type="button" className="monthgrid__nav" aria-label="ماه قبل" onClick={() => setYm((v) => shiftMonth(v.jy, v.jm, -1))}>
          <Icon name="arrow-right" size="md" />
        </button>
        <strong>
          {grid.monthName} {faNum(grid.jy, { useGrouping: false })}
        </strong>
        <button type="button" className="monthgrid__nav" aria-label="ماه بعد" onClick={() => setYm((v) => shiftMonth(v.jy, v.jm, 1))}>
          <Icon name="arrow-left" size="md" />
        </button>
      </div>
      <div className="monthgrid__week" aria-hidden>
        {JALALI_WEEKDAYS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="monthgrid__days">
        {Array.from({ length: grid.leadingBlanks }, (_, i) => (
          <span key={`b${i}`} />
        ))}
        {grid.days.map((d) => (
          <button
            key={d.iso}
            type="button"
            className={`monthgrid__day${value === d.iso ? " monthgrid__day--on" : ""}${marked.has(d.iso) ? " monthgrid__day--marked" : ""}`}
            aria-pressed={value === d.iso}
            aria-label={`${faNum(d.jd)} ${grid.monthName}${marked.has(d.iso) ? " (تعطیل ثبت‌شده)" : ""}`}
            onClick={() => onChange(d.iso)}
          >
            {/* A day cell is its own label: the day number, a dot when a holiday is recorded, and the filled accent when chosen; an icon in 31 cells would only crowd the grid. */}
            {faNum(d.jd)}
          </button>
        ))}
      </div>
    </div>
  );
}
