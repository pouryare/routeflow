"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import { faNum } from "@/lib/format";
import {
  JALALI_WEEKDAYS,
  faJalaliDate,
  jalaliMonthGrid,
  shiftMonth,
  toJalali,
  todayJalali,
  jalaliToIsoDate,
} from "@/lib/jalali";

/** A date field that speaks Shamsi (items 19 and 21, the input half).
 *
 *  `<input type="date">` shows the browser's Gregorian calendar; a reader picking an
 *  expiry date or a cheque's due date was asked to think ~621 years off. This is the
 *  Jalali picker spec slice N promised: the value is still an ISO `YYYY-MM-DD` (what the
 *  API and the database store), only the reading and the picking are Jalali. A hidden
 *  input carries `name`, so it works inside a plain <form> exactly as the native one did.
 *
 *  Keyboard: the arrows move a day (a week up/down), Enter picks, Escape closes.
 *  The month grid, the week start and the ISO conversion are lib/jalali.ts. */
export default function JalaliDateInput({
  value,
  onChange,
  name,
  id,
  required = false,
  placeholder = "انتخاب تاریخ",
  className = "",
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (iso: string) => void;
  name?: string;
  id?: string;
  required?: boolean;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const auto = useId();
  const gridId = `${id ?? auto}-grid`;
  const wrap = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const start = toJalali(value) ?? todayJalali();
  const [view, setView] = useState({ jy: start.jy, jm: start.jm });
  const [cursor, setCursor] = useState<string>(value || jalaliToIsoDate(start.jy, start.jm, start.jd));

  /* Close on an outside press, the way a native picker does. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const openAt = () => {
    const s = toJalali(value) ?? todayJalali();
    setView({ jy: s.jy, jm: s.jm });
    setCursor(value || jalaliToIsoDate(s.jy, s.jm, s.jd));
    setOpen(true);
  };

  const pick = (iso: string) => {
    onChange(iso);
    setOpen(false);
  };

  const moveCursor = (days: number) => {
    const next = new Date(Date.parse(`${cursor}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
    setCursor(next);
    const j = toJalali(next);
    if (j && (j.jy !== view.jy || j.jm !== view.jm)) setView({ jy: j.jy, jm: j.jm });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) return;
    /* RTL: the right arrow moves toward the start of the week, i.e. back a day. */
    const step: Record<string, number> = { ArrowRight: -1, ArrowLeft: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in step) {
      e.preventDefault();
      moveCursor(step[e.key]);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(cursor);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  const grid = jalaliMonthGrid(view.jy, view.jm);
  const today = (() => {
    const t = todayJalali();
    return jalaliToIsoDate(t.jy, t.jm, t.jd);
  })();

  return (
    <div className={`jdate ${className}`.trim()} ref={wrap} onKeyDown={onKey}>
      {name ? <input type="hidden" name={name} value={value} required={required} /> : null}
      <button
        type="button"
        id={id}
        className="jdate__field"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? gridId : undefined}
        aria-label={ariaLabel ? `${ariaLabel}: ${value ? faJalaliDate(value) : "خالی"}` : undefined}
        onClick={() => (open ? setOpen(false) : openAt())}
      >
        <Icon name="calendar" size="sm" />
        <span className={value ? "jdate__value" : "jdate__placeholder"}>{value ? faJalaliDate(value) : placeholder}</span>
      </button>

      {open ? (
        <div className="jdate__pop" role="dialog" aria-label="انتخاب تاریخ" id={gridId}>
          <div className="jdate__head">
            <button type="button" className="jdate__nav" aria-label="ماه قبل" onClick={() => setView(shiftMonth(view.jy, view.jm, -1))}>
              <Icon name="chevron-right" size="sm" />
            </button>
            <span className="jdate__month">
              {grid.monthName} {faNum(view.jy).replace(/٬/g, "")}
            </span>
            <button type="button" className="jdate__nav" aria-label="ماه بعد" onClick={() => setView(shiftMonth(view.jy, view.jm, 1))}>
              <Icon name="chevron-left" size="sm" />
            </button>
          </div>
          <div className="jdate__grid" role="grid" aria-label={`${grid.monthName} ${view.jy}`}>
            {JALALI_WEEKDAYS.map((d) => (
              <span key={d} className="jdate__wd" role="columnheader">
                {d}
              </span>
            ))}
            {Array.from({ length: grid.leadingBlanks }, (_, i) => (
              <span key={`b${i}`} aria-hidden="true" />
            ))}
            {grid.days.map((d) => (
              <button
                key={d.iso}
                type="button"
                role="gridcell"
                tabIndex={d.iso === cursor ? 0 : -1}
                aria-selected={d.iso === value}
                className={`jdate__day${d.iso === value ? " is-picked" : ""}${d.iso === today ? " is-today" : ""}${d.iso === cursor ? " is-cursor" : ""}`}
                onClick={() => pick(d.iso)}
              >
                {faNum(d.jd)}
              </button>
            ))}
          </div>
          <div className="jdate__foot">
            <button type="button" className="btn ghost" onClick={() => pick(today)}>
              امروز
            </button>
            {!required && value ? (
              <button type="button" className="btn ghost" onClick={() => pick("")}>
                پاک کردن
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
