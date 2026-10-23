"use client";

import { useState } from "react";
import { parseDate, type CalendarDate, type DateValue } from "@internationalized/date";
import { Button, Calendar } from "@heroui/react";
import { Icon } from "@/components/meridian/Icon";
import DayChips from "@/components/mobile/DayChips";
import { addDaysIso } from "@/lib/flows/dates";

/** A day, for a flow step. The presets are answers: tapping one submits at once. The calendar
 *  underneath is for the date nobody can express as an offset. A host renders this from
 *  `renderCustom` for a `date` step, passing the option that moves on.
 *
 *  The calendar is HeroUI's, shown in Shamsi months with Persian digits by HeroUIProvider's
 *  locale. Its values stay Gregorian `CalendarDate`s: React Aria hands back the calendar it was
 *  given, so `toString()` is the ISO day the flow stores, with no conversion of our own. */
export default function DateStep({ optionId, optionLabel, skip, from, presets, ariaLabel, submit }: {
  optionId: string;
  optionLabel: string;
  /** A way forward that names no day -- «تاریخ انقضا ندارد». Submits with no value. */
  skip?: { id: string; label: string };
  /** The day the presets count from (today, as ISO). */
  from: string;
  presets: { label: string; days: number }[];
  ariaLabel: string;
  submit: (optionId: string, value?: string) => void;
}) {
  const [iso, setIso] = useState("");
  return (
    <div className="tf-date">
      <div className="tf-grid">
        {presets.map((p) => (
          <button
            key={p.days}
            type="button"
            className="inline-flex items-center justify-center gap-[var(--space-2)] tf-opt"
            onClick={() => submit(optionId, addDaysIso(from, p.days))}
          >
            <Icon name="calendar" size="md" />
            {p.label}
          </button>
        ))}
      </div>
      <p className="tf-sub">{presets.length ? "یا روز دیگری را انتخاب کنید" : "کدام روز؟"}</p>
      {presets.length ? (
        <FlowCalendar value={iso} min={from} onChange={setIso} ariaLabel={ariaLabel} />
      ) : (
        <DayChips value={iso} onChange={setIso} ariaLabel={ariaLabel} />
      )}
      <Button variant="primary" size="lg" fullWidth isDisabled={iso === ""} onPress={() => submit(optionId, iso)}>
        <Icon name="check" size="md" />
        {optionLabel}
      </Button>
      {skip ? (
        <Button variant="ghost" className="flow-drawer__skip" onPress={() => submit(skip.id)}>
          <Icon name="arrow-left" size="md" />
          {skip.label}
        </Button>
      ) : null}
    </div>
  );
}

/** One month, Saturday first, nothing before `min`. The month arrows carry our own icons,
 *  pointing the way the months move in a right-to-left grid. */
function FlowCalendar({ value, min, onChange, ariaLabel }: {
  value: string;
  min: string;
  onChange: (iso: string) => void;
  ariaLabel: string;
}) {
  return (
    <Calendar
      className="flow-calendar"
      aria-label={ariaLabel}
      value={value ? parseDate(value) : null}
      minValue={parseDate(min)}
      firstDayOfWeek="sat"
      onChange={(d: DateValue) => onChange(d.toString().slice(0, 10))}
    >
      <Calendar.Header>
        <Calendar.Heading />
        <Calendar.NavButton slot="previous" aria-label="ماه قبل">
          <Icon name="chevron-right" size="sm" />
        </Calendar.NavButton>
        <Calendar.NavButton slot="next" aria-label="ماه بعد">
          <Icon name="chevron-left" size="sm" />
        </Calendar.NavButton>
      </Calendar.Header>
      {/* Narrow weekday names (ش ی د …): the long ones run into each other at phone width. */}
      <Calendar.Grid weekdayStyle="narrow">
        <Calendar.GridHeader>{(day: string) => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}</Calendar.GridHeader>
        <Calendar.GridBody>{(date: CalendarDate) => <Calendar.Cell date={date} />}</Calendar.GridBody>
      </Calendar.Grid>
    </Calendar>
  );
}
