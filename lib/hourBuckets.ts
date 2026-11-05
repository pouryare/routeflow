/** Orders by the hour of the day they were taken (Tehran time), for the «ساعت‌های شلوغ» card. Pure, so the
 *  time-zone handling and the busiest-hour rule are tested. */

const TEHRAN_HOUR = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tehran", hour: "2-digit", hourCycle: "h23" });

/** 24 counts, index = hour 0..23 in Tehran. Timestamps that do not parse are skipped. */
export function hourBuckets(isoTimes: string[]): number[] {
  const out = Array.from({ length: 24 }, () => 0);
  for (const t of isoTimes) {
    const ms = Date.parse(t);
    if (Number.isNaN(ms)) continue;
    const h = Number(TEHRAN_HOUR.format(ms));
    if (h >= 0 && h < 24) out[h] += 1;
  }
  return out;
}

/** The first hour with the most orders, or null when there are none at all. */
export function busiestHour(counts: number[]): number | null {
  const max = Math.max(...counts);
  return max > 0 ? counts.indexOf(max) : null;
}
