"use client";

import { faDigits } from "@/lib/format";
import { useDismissOnOutside } from "@/lib/useDismissOnOutside";
import { useState, useRef, useCallback } from "react";
import { Icon } from "@/components/meridian/Icon";
import {
  jalaliMonthGrid,
  toJalali,
  todayJalali,
  shiftMonth,
  faJalaliDate,
  JALALI_MONTHS,
  JALALI_WEEKDAYS,
  jalaliToIsoDate,
} from "@/lib/jalali";

/** Roughly the popover's rendered height: header, weekday row, six day rows and the
 *  «امروز» button. Only used to decide which way to open, so an approximation is fine. */
const POPOVER_HEIGHT = 300;

/** A Shamsi date picker over an ISO value.
 *
 *  The value going in and out is always an ISO `YYYY-MM-DD` -- the calendar is a display
 *  and input concern only, and a Jalali string in the database would break every range
 *  query in the app. Everything Persian happens between the two conversions here.
 *
 *  A month grid rather than three dropdowns: this gets used on a phone, and picking
 *  «۴ شهریور» off a calendar is one tap where three selects are three. It also makes the
 *  weekday visible, which matters when someone is dating an order they took on Thursday.
 */
export default function JalaliDatePicker({
  value,
  onChange,
  label,
  id,
}: {
  /** ISO `YYYY-MM-DD`. */
  value: string;
  onChange: (iso: string) => void;
  label?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => {
    const at = toJalali(value) ?? todayJalali();
    return { jy: at.jy, jm: at.jm };
  });
  const [dropUp, setDropUp] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Reopening shows the month the current value is in, not wherever the reader last
  // browsed to. Done on the way in rather than in an effect keyed on `open`: the month
  // to show is a consequence of the click, so deriving it there is both simpler and one
  // fewer render than letting an effect correct the state afterwards.
  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const at = toJalali(value) ?? todayJalali();
    setView({ jy: at.jy, jm: at.jm });

    // Open upward when there is not room below. An absolutely positioned popover does
    // not extend the page's scroll height, so one that overflows the bottom of a phone
    // screen cannot be scrolled to -- the calendar is simply unreachable. Measured on
    // the click, which is the only moment the answer is knowable.
    const rect = boxRef.current?.getBoundingClientRect();
    setDropUp(rect ? window.innerHeight - rect.bottom < POPOVER_HEIGHT : false);
    setOpen(true);
  }

  const dismiss = useCallback(() => setOpen(false), []);
  useDismissOnOutside(open, dismiss, boxRef);

  const grid = jalaliMonthGrid(view.jy, view.jm);
  const today = todayJalali();
  const todayIso = jalaliToIsoDate(today.jy, today.jm, today.jd);

  return (
    <div className="relative" ref={boxRef}>
      {label && (
        <label
          htmlFor={id}
          className="mb-[var(--space-1)] block text-[length:var(--text-xs)] text-[var(--text-muted)]"
        >
          {label}
        </label>
      )}

      <button
        id={id}
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex items-center justify-center gap-[var(--space-2)] w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] text-right text-[length:var(--text-sm)] tabular-nums text-[var(--text)] transition-colors duration-[var(--dur-base)] hover:border-[var(--border-strong)] focus:border-[var(--accent)] focus:outline-none"
      >
        <Icon name="calendar" size="sm" />
        {faJalaliDate(value)}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="انتخاب تاریخ"
          className={`absolute z-[var(--z-panel)] w-[280px] ${dropUp ? "bottom-full mb-[var(--space-1)]" : "mt-[var(--space-1)]"} rounded-[var(--radius-lg)] border border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-3)] shadow-lg`}
        >
          <div className="mb-[var(--space-2)] flex items-center justify-between">
            <button
              type="button"
              aria-label="ماه قبل"
              onClick={() => setView((v) => shiftMonth(v.jy, v.jm, -1))}
              className="rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text)]"
            >
              <Icon name="chevron-right" size="md" />
              ›
            </button>
            <span className="text-[length:var(--text-sm)] text-[var(--text)]">
              {JALALI_MONTHS[view.jm - 1]} {faDigits(String(view.jy))}
            </span>
            <button
              type="button"
              aria-label="ماه بعد"
              onClick={() => setView((v) => shiftMonth(v.jy, v.jm, 1))}
              className="rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text)]"
            >
              <Icon name="chevron-left" size="md" />
              ‹
            </button>
          </div>

          <div className="grid grid-cols-7 gap-[2px] text-center">
            {JALALI_WEEKDAYS.map((d, i) => (
              <span
                key={i}
                className="py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-faint)]"
              >
                {d}
              </span>
            ))}

            {Array.from({ length: grid.leadingBlanks }, (_, i) => (
              <span key={`blank-${i}`} />
            ))}

            {grid.days.map((day) => {
              const isSelected = day.iso === value;
              const isToday = day.iso === todayIso;
              return (
                <button
                  key={day.iso}
                  type="button"
                  onClick={() => {
                    onChange(day.iso);
                    setOpen(false);
                  }}
                  aria-current={isSelected ? "date" : undefined}
                  className={`rounded-[var(--radius-sm)] py-[var(--space-1)] text-[length:var(--text-sm)] tabular-nums transition-colors duration-[var(--dur-fast)] ${
                    isSelected
                      ? "bg-[var(--accent)] text-accent-ink"
                      : isToday
                        ? "border border-[var(--accent-dim)] text-[var(--text)] hover:bg-white/5"
                        : "text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text)]"
                  }`}
                >
                  {faDigits(String(day.jd))}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => {
              onChange(todayIso);
              setOpen(false);
            }}
            className="mt-[var(--space-2)] w-full rounded-[var(--radius-sm)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--accent)]"
          >
            <Icon name="calendar" size="sm" />
            امروز
          </button>
        </div>
      )}
    </div>
  );
}
