"use client";

import { useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import JalaliDateInput from "@/components/meridian/JalaliDateInput";
import { addDaysIso } from "@/lib/flows/dates";

/** A day, for a flow step. The presets are answers: tapping one submits at once. The calendar
 *  underneath is for the date nobody can express as an offset. A host renders this from
 *  `renderCustom` for a `date` step, passing the option that moves on. */
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
      <p className="tf-sub">یا تاریخ دیگری را انتخاب کنید</p>
      <JalaliDateInput value={iso} onChange={setIso} aria-label={ariaLabel} />
      <button
        type="button"
        className="inline-flex items-center justify-center gap-[var(--space-2)] tf-go"
        disabled={iso === ""}
        onClick={() => submit(optionId, iso)}
      >
        <Icon name="check" size="md" />
        {optionLabel}
      </button>
      {skip ? (
        <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] tf-skip" onClick={() => submit(skip.id)}>
          <Icon name="arrow-left" size="md" />
          {skip.label}
        </button>
      ) : null}
    </div>
  );
}
