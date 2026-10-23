"use client";

import PersianDateField from "@/components/PersianDateField";

/** A date field that speaks Shamsi, over an ISO value: the name callers already use for
 *  PersianDateField (a HeroUI button opening HeroUI's Persian Calendar in a sheet). On a phone
 *  path prefer DayChips; `check:mobile` lists the files that import this one. */
export default function JalaliDateInput({
  "aria-label": ariaLabel,
  ...rest
}: Omit<Parameters<typeof PersianDateField>[0], "ariaLabel"> & { "aria-label"?: string }) {
  return <PersianDateField {...rest} ariaLabel={ariaLabel} />;
}
