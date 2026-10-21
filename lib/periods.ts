import { jalaliMonthLength, jalaliToIsoDate, shiftMonth, toJalali } from "@/lib/jalali";
import { addDaysIso } from "@/lib/flows/dates";

/** The date ranges people actually ask for, as answers instead of two date fields.
 *
 *  "Month" is the Persian month (1 Mehr to the last day of Mehr), never the Gregorian one: a
 *  report for «این ماه» that starts on the 1st of October is wrong for everyone in Iran. Ranges are
 *  inclusive ISO days. `custom` carries whatever the caller already holds. */
export const PERIODS = ["all", "today", "yesterday", "last_7_days", "this_month", "last_month", "custom"] as const;
export type Period = (typeof PERIODS)[number];

export const PERIOD_LABEL: Record<Period, string> = {
  all: "همه زمان‌ها",
  today: "امروز",
  yesterday: "دیروز",
  last_7_days: "۷ روز گذشته",
  this_month: "این ماه",
  last_month: "ماه قبل",
  custom: "بازهٔ دلخواه",
};

export interface DayRange {
  from: string;
  to: string;
}

function monthRange(jy: number, jm: number): DayRange {
  return { from: jalaliToIsoDate(jy, jm, 1), to: jalaliToIsoDate(jy, jm, jalaliMonthLength(jy, jm)) };
}

/** The inclusive range of a period as of `today` (an ISO day). `all` is an open range (empty
 *  strings, which every filter here treats as "no bound"); `custom` returns `custom` untouched. */
export function periodRange(period: Period, today: string, custom: DayRange = { from: "", to: "" }): DayRange {
  switch (period) {
    case "all":
      return { from: "", to: "" };
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = addDaysIso(today, -1);
      return { from: y, to: y };
    }
    case "last_7_days":
      return { from: addDaysIso(today, -6), to: today };
    case "this_month":
    case "last_month": {
      const j = toJalali(today);
      if (!j) return { from: "", to: "" };
      const ym = period === "this_month" ? { jy: j.jy, jm: j.jm } : shiftMonth(j.jy, j.jm, -1);
      return monthRange(ym.jy, ym.jm);
    }
    case "custom":
      return custom;
  }
}

/** Is `day` (an ISO day) inside the range? An empty bound is open. */
export function inRange(day: string, r: DayRange): boolean {
  return (r.from === "" || day >= r.from) && (r.to === "" || day <= r.to);
}
