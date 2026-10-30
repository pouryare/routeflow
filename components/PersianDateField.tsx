"use client";

import { HelpHint, HelpRow } from "@/components/meridian/HelpHint";
import { useMemo, useState } from "react";
import { GregorianCalendar, PersianCalendar as ShamsiCalendar, parseDate, toCalendar, type CalendarDate, type DateValue } from "@internationalized/date";
import { Button, Calendar } from "@heroui/react";
import { Icon } from "@/components/meridian/Icon";
import DateReel from "@/components/mobile/DateReel";
import BottomSheet from "@/components/mobile/BottomSheet";
import { faJalaliDate, todayJalali, jalaliToIsoDate } from "@/lib/jalali";

const SHAMSI = new ShamsiCalendar();
const GREGORIAN = new GregorianCalendar();
/** An ISO day as a Shamsi date. React Aria lays the grid out in the calendar of the dates it
 *  is handed when they disagree with the locale, so a Gregorian bound turned the months back
 *  into «اکتبر»; every date going in is Shamsi. */
const shamsi = (iso: string) => toCalendar(parseDate(iso), SHAMSI);
const isoOf = (d: DateValue) => toCalendar(d, GREGORIAN).toString().slice(0, 10);

/** One month of HeroUI's Calendar, Saturday first, in Shamsi months with Persian digits (the
 *  locale comes from HeroUIProvider). Dates go in as Shamsi and come back out as the ISO
 *  (Gregorian) day we store. The month arrows carry our icons, pointing the way the months
 *  move in a right-to-left grid. */
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
  // Stable objects: React Aria keys its calendar state on their identity.
  const shown = useMemo(() => (value ? shamsi(value) : null), [value]);
  const floor = useMemo(() => (min ? shamsi(min) : undefined), [min]);
  return (
    <Calendar
      className={className}
      aria-label={ariaLabel}
      value={shown}
      minValue={floor}
      isDateUnavailable={isDisabled ? (d: DateValue) => isDisabled(isoOf(d)) : undefined}
      firstDayOfWeek="sat"
      onChange={(d: DateValue) => onChange(isoOf(d))}
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
  const [calendar, setCalendar] = useState(false);
  const [draft, setDraft] = useState("");
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
        onPress={() => { setDraft(""); setCalendar(false); setOpen(true); }}
      >
        <Icon name="calendar" size="sm" />
        <span className={value ? "jdate__value" : "jdate__placeholder"}>{value ? faJalaliDate(value) : placeholder}</span>
      </Button>

      <BottomSheet open={open} title={title} onClose={() => setOpen(false)} closeLabel="بستن تقویم">
        <HelpRow>
          <HelpHint title="انتخاب تاریخ" label="راهنمای انتخاب تاریخ">
            <p className="mhelp__what">روی یک روز بزنید تا انتخاب شود؛ با پیکان‌ها ماه را عوض کنید.</p>
            <p className="mhelp__how">«امروز» تاریخ امروز را می‌گذارد.</p>
          </HelpHint>
        </HelpRow>
        {calendar ? (
          <PersianCalendar value={value} onChange={pick} isDisabled={isDisabled} ariaLabel={title} />
        ) : (
          <DateReel value={value} onChange={setDraft} />
        )}
        <div className="jdate__foot">
          {!calendar && (
            <Button variant="primary" onPress={() => pick(draft || value || todayIso())}>
              <Icon name="check" size="md" />
              تأیید
            </Button>
          )}
          <Button variant="tertiary" onPress={() => setCalendar((v) => !v)}>
            <Icon name="calendar" size="md" />
            {calendar ? "چرخ تاریخ" : "تقویم"}
          </Button>
          <Button variant="tertiary" onPress={() => pick(todayIso())}>
            <Icon name="calendar" size="md" />
            امروز
          </Button>
          {!required && value ? (
            <Button variant="tertiary" onPress={() => pick("")}>
              <Icon name="x" size="md" />
              پاک کردن تاریخ
            </Button>
          ) : null}
        </div>
      </BottomSheet>
    </div>
  );
}
