"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { boxOf, slidePill, type Box } from "@/lib/pillSlide";
import { Button, ToggleButton } from "@heroui/react";
import { HelpHint, HelpRow } from "@/components/meridian/HelpHint";
import { Icon } from "@/components/meridian/Icon";
import { PersianCalendar } from "@/components/PersianDateField";
import { dayChoices, solarHolidaysAround, weekDays } from "@/lib/dayChoices";
import { tehranTodayIso } from "@/lib/jalali";

/** Choose a day the way people say it: «امروز / فردا / پس‌فردا / شنبه ۱۲…», then a swipeable
 *  fortnight, and only then the full calendar. Replaces a date field as the first thing shown.
 *
 *  Holidays the calendar knows (the solar ones) are marked, or hidden when `skipHolidays` (a
 *  delivery day); Fridays are marked, never hidden. `value` is an ISO day or "".
 *
 *  Built on HeroUI: each day is a ToggleButton, so the chosen one is announced as pressed, and
 *  the full calendar is PersianCalendar (HeroUI's, in Shamsi months). */
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

  /* The chosen chip's fill slides over from the one chosen before (lib/pillSlide). */
  const root = useRef<HTMLDivElement | null>(null);
  const lastPill = useRef<{ mode: string; box: Box } | null>(null);
  useLayoutEffect(() => {
    const on = root.current?.querySelector(".daychip--on");
    if (!on) return;
    const box = boxOf(on);
    if (lastPill.current?.mode === mode) slidePill(on, lastPill.current.box, box, "::before");
    lastPill.current = { mode, box };
  }, [value, mode]);

  const choices = useMemo(() => dayChoices(today, { holidays: known, count, skipHolidays }), [today, known, count, skipHolidays]);
  const strip = useMemo(() => weekDays(today, 14, known), [today, known]);

  const chip = (iso: string, label: string, sub: string | undefined, flag: string | undefined) => (
    <ToggleButton
      key={iso}
      className={`daychip${value === iso ? " daychip--on" : ""}${flag ? ` daychip--${flag}` : ""}`}
      isSelected={value === iso}
      onChange={() => onChange(iso)}
    >
      <Icon name={value === iso ? "check" : "calendar"} size="sm" />
      <span>{label}</span>
      {sub ? <small>{flag === "holiday" ? `${sub} · تعطیل` : flag === "weekend" ? `${sub} · جمعه` : sub}</small> : null}
    </ToggleButton>
  );

  return (
    <div ref={root} className="daychips" role="group" aria-label={ariaLabel}>
      <HelpRow>
        <HelpHint title="انتخاب روز" label="راهنمای انتخاب روز">
          <p className="mhelp__what">امروز، فردا یا یکی از روزهای نزدیک را بزنید. برای روز دیگر «روز دیگر…» را بزنید و از تقویم انتخاب کنید.</p>
          <p className="mhelp__how">روزهای تعطیل و جمعه‌ها خط‌چین‌اند.</p>
        </HelpHint>
      </HelpRow>
      {mode === "chips" && (
        <div className="daychips__row">
          {choices.map((c) =>
            c.kind === "day" ? (
              chip(c.iso!, c.label, c.sub, c.flag)
            ) : (
              <Button key="other" variant="secondary" className="daychip" onPress={() => setMode("strip")}>
                <Icon name="arrow-left" size="sm" />
                <span>{c.label}</span>
              </Button>
            ),
          )}
        </div>
      )}
      {mode === "strip" && (
        <>
          <div className="daychips__row daychips__row--strip">{strip.map((d) => chip(d.iso!, d.label, d.sub, d.flag))}</div>
          <Button variant="ghost" className="daychips__link" onPress={() => setMode("calendar")}>
            <Icon name="calendar" size="sm" />
            تقویم کامل
          </Button>
        </>
      )}
      {mode === "calendar" && <PersianCalendar value={value} onChange={onChange} ariaLabel={ariaLabel} />}
      {mode !== "chips" && (
        <Button variant="ghost" className="daychips__link" onPress={() => setMode("chips")}>
          <Icon name="arrow-right" size="sm" />
          برگشت به روزهای نزدیک
        </Button>
      )}
    </div>
  );
}
