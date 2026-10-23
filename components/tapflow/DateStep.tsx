"use client";

import { useState } from "react";
import { Button } from "@heroui/react";
import { PersianCalendar } from "@/components/PersianDateField";
import { Icon } from "@/components/meridian/Icon";
import DayChips from "@/components/mobile/DayChips";
import { addDaysIso } from "@/lib/flows/dates";

/** A day, for a flow step. The presets are answers: tapping one submits at once. The calendar
 *  underneath is for the date nobody can express as an offset. A host renders this from
 *  `renderCustom` for a `date` step, passing the option that moves on.
 *
 *  The calendar is PersianCalendar: HeroUI's, in Shamsi months, storing ISO days. */
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
        <PersianCalendar value={iso} min={from} onChange={setIso} ariaLabel={ariaLabel} />
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
