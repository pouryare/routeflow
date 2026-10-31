import { jalaliMonthLength, jalaliToIsoDate } from "@/lib/jalali";

/** What the date drums land on: a day past the end of a short month (۳۱ in مهر) is pulled back to
 *  the month's last day, and the result carries the ISO day we store. */
export function reelDate(jy: number, jm: number, jd: number): { jy: number; jm: number; jd: number; iso: string } {
  const day = Math.min(jd, jalaliMonthLength(jy, jm));
  return { jy, jm, jd: day, iso: jalaliToIsoDate(jy, jm, day) };
}
