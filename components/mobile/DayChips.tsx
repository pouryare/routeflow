"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import JalaliDateInput from "@/components/meridian/JalaliDateInput";
import { dayChoices, solarHolidaysAround, weekDays } from "@/lib/dayChoices";
import { tehranTodayIso } from "@/lib/jalali";

/** Choose a day the way people say it: «امروز / فردا / پس‌فردا / شنبه ۱۲…», then a swipeable
 *  fortnight, and only then the full calendar. Replaces a date field as the first thing shown.
 *
 *  Holidays the calendar knows (the solar ones) are marked, or hidden when `skipHolidays` (a
 *  delivery day); Fridays are marked, never hidden. `value` is an ISO day or "". */
export default function DayChips({
  value,
  onChange,
  ariaLabel,
  skipHolidays = false,
  count = 5,
  holidays,
}: {
  value: string;
  onChange: (iso: string) => void;
  ariaLabel: string;
  skipHolidays?: boolean;
  count?: number;
  /** Extra holidays the caller knows (the lunar ones live in the database). */
  holidays?: Set<string>;
}) {
  const today = useMemo(() => tehranTodayIso(), []);
  const known = useMemo(() => {
    const s = solarHolidaysAround(today, 120);
    for (const h of holidays ?? []) s.add(h);
    return s;
  }, [today, holidays]);
  const [mode, setMode] = useState<"chips" | "strip" | "calendar">("chips");

  const choices = useMemo(() => dayChoices(today, { holidays: known, count, skipHolidays }), [today, known, count, skipHolidays]);
  const strip = useMemo(() => weekDays(today, 14, known), [today, known]);

  const chip = (iso: string, label: string, sub: string | undefined, flag: string | undefined) => (
    <button
      key={iso}
      type="button"
      className={`daychip${value === iso ? " daychip--on" : ""}${flag ? ` daychip--${flag}` : ""}`}
      aria-pressed={value === iso}
      onClick={() => onChange(iso)}
    >
      <Icon name={value === iso ? "check" : "calendar"} size="sm" />
      <span>{label}</span>
      {sub ? <small>{flag === "holiday" ? `${sub} · تعطیل` : flag === "weekend" ? `${sub} · جمعه` : sub}</small> : null}
    </button>
  );

  return (
    <div className="daychips" role="group" aria-label={ariaLabel}>
      {mode === "chips" && (
        <div className="daychips__row">
          {choices.map((c) =>
            c.kind === "day" ? (
              chip(c.iso!, c.label, c.sub, c.flag)
            ) : (
              <button key="other" type="button" className="daychip" onClick={() => setMode("strip")}>
                <Icon name="arrow-left" size="sm" />
                <span>{c.label}</span>
              </button>
            ),
          )}
        </div>
      )}
      {mode === "strip" && (
        <>
          <div className="daychips__row daychips__row--strip">{strip.map((d) => chip(d.iso!, d.label, d.sub, d.flag))}</div>
          <button type="button" className="daychips__link" onClick={() => setMode("calendar")}>
            <Icon name="calendar" size="sm" />
            تقویم کامل
          </button>
        </>
      )}
      {mode === "calendar" && <JalaliDateInput value={value} onChange={onChange} aria-label={ariaLabel} />}
      {mode !== "chips" && (
        <button type="button" className="daychips__link" onClick={() => setMode("chips")}>
          <Icon name="arrow-right" size="sm" />
          برگشت به روزهای نزدیک
        </button>
      )}
    </div>
  );
}
