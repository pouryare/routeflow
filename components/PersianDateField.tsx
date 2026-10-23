"use client";

import { useState } from "react";
import { parseDate, type CalendarDate, type DateValue } from "@internationalized/date";
import { Button, Calendar } from "@heroui/react";
import { Icon } from "@/components/meridian/Icon";
import BottomSheet from "@/components/mobile/BottomSheet";
import { faJalaliDate, todayJalali, jalaliToIsoDate } from "@/lib/jalali";

/** One month of HeroUI's Calendar, Saturday first, in Shamsi months with Persian digits (the
 *  locale comes from HeroUIProvider). Its values stay Gregorian `CalendarDate`s: React Aria
 *  hands back the calendar it was given, so `toString()` is the ISO day we store, with no
 *  conversion of our own. The month arrows carry our icons, pointing the way the months move
 *  in a right-to-left grid. */
export function PersianCalendar({ value, onChange, min, isDisabled, ariaLabel, className = "flow-calendar" }: {
  /** ISO `YYYY-MM-DD`, or "" for none. */
  value: string;
  onChange: (iso: string) => void;
  /** No day before this ISO day. */
  min?: string;
  /** Days that cannot be picked, e.g. a day the person is already booked for. */
  isDisabled?: (iso: string) => boolean;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <Calendar
      className={className}
      aria-label={ariaLabel}
      value={value ? parseDate(value) : null}
      minValue={min ? parseDate(min) : undefined}
      isDateUnavailable={isDisabled ? (d: DateValue) => isDisabled(d.toString().slice(0, 10)) : undefined}
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

const todayIso = () => {
  const t = todayJalali();
  return jalaliToIsoDate(t.jy, t.jm, t.jd);
};

/** A date field that speaks Shamsi, over an ISO value (items 19 and 21).
 *
 *  The field is a HeroUI button reading the day in Shamsi; a tap opens the PersianCalendar in a
 *  bottom sheet (sheets, not popovers, on a phone), with «امروز» and, for an optional field,
 *  «پاک کردن». Picking a day closes the sheet. A hidden input carries `name`, so the field works
 *  inside a plain <form> exactly as the native one did. Keyboard: React Aria's grid -- arrows
 *  move a day or a week, Enter picks, Escape closes. */
export default function PersianDateField({
  value,
  onChange,
  name,
  id,
  required = false,
  placeholder = "انتخاب تاریخ",
  className = "",
  isDisabled,
  ariaLabel,
}: {
  value: string;
  onChange: (iso: string) => void;
  name?: string;
  id?: string;
  required?: boolean;
  placeholder?: string;
  className?: string;
  isDisabled?: (iso: string) => boolean;
  /** What the date is: «تاریخ سررسید». Names the field and titles the sheet. */
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const pick = (iso: string) => {
    if (iso && isDisabled?.(iso)) return;
    onChange(iso);
    setOpen(false);
  };
  const title = ariaLabel ?? placeholder;

  return (
    <div className={`jdate ${className}`.trim()}>
      {name ? <input type="hidden" name={name} value={value} required={required} /> : null}
      <Button
        id={id}
        variant="secondary"
        className="jdate__field"
        aria-haspopup="dialog"
        aria-label={ariaLabel ? `${ariaLabel}: ${value ? faJalaliDate(value) : "خالی"}` : undefined}
        onPress={() => setOpen(true)}
      >
        <Icon name="calendar" size="sm" />
        <span className={value ? "jdate__value" : "jdate__placeholder"}>{value ? faJalaliDate(value) : placeholder}</span>
      </Button>

      <BottomSheet open={open} title={title} onClose={() => setOpen(false)} closeLabel="بستن تقویم">
        <PersianCalendar value={value} onChange={pick} isDisabled={isDisabled} ariaLabel={title} />
        <div className="jdate__foot">
          <Button variant="tertiary" onPress={() => pick(todayIso())}>
            <Icon name="calendar" size="md" />
            امروز
          </Button>
          {!required && value ? (
            <Button variant="tertiary" onPress={() => pick("")}>
              <Icon name="trash" size="md" />
              پاک کردن تاریخ
            </Button>
          ) : null}
        </div>
      </BottomSheet>
    </div>
  );
}
