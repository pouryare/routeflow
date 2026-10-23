"use client";

import PersianDateField from "@/components/PersianDateField";

/** A labelled Shamsi date field over an ISO `YYYY-MM-DD` value, for the desk forms (order,
 *  purchase, catalogue and commission dates). The value going in and out is always ISO -- a
 *  Jalali string in the database would break every range query -- and the picking is
 *  PersianDateField's: HeroUI's Persian Calendar in a sheet, a day in one tap with its
 *  weekday visible. */
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
  return (
    <div>
      {label && (
        <label
          htmlFor={id}
          className="mb-[var(--space-1)] block text-[length:var(--text-xs)] text-[var(--text-muted)]"
        >
          {label}
        </label>
      )}
      <PersianDateField id={id} value={value} onChange={onChange} required ariaLabel={label} className="w-full" />
    </div>
  );
}
