/** A driver's working hours, read from their runs: the first start and the last finish of each day,
 *  and the minutes between each run's own start and finish added up. No new button for the driver. */
export interface HoursRun {
  driver_user_id: number;
  driver_name: string;
  run_date: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface DriverDay {
  driver_user_id: number;
  driver_name: string;
  run_date: string;
  runs: number;
  first_start: string | null;
  last_finish: string | null;
  minutes: number;
  /** A run that started and is not finished yet; its time is not counted. */
  open: boolean;
}

/** Newest day first, then driver name. Runs that never started add a run to the count and nothing else. */
export function driverDays(runs: HoursRun[]): DriverDay[] {
  const by = new Map<string, DriverDay>();
  for (const r of runs) {
    const key = `${r.run_date}:${r.driver_user_id}`;
    const d = by.get(key) ?? { driver_user_id: r.driver_user_id, driver_name: r.driver_name, run_date: r.run_date, runs: 0, first_start: null, last_finish: null, minutes: 0, open: false };
    d.runs += 1;
    if (r.started_at) {
      if (!d.first_start || r.started_at < d.first_start) d.first_start = r.started_at;
      if (r.finished_at) {
        if (!d.last_finish || r.finished_at > d.last_finish) d.last_finish = r.finished_at;
        d.minutes += Math.max(0, Math.round((Date.parse(r.finished_at) - Date.parse(r.started_at)) / 60000));
      } else if (r.status === "in_progress") d.open = true;
    }
    by.set(key, d);
  }
  return [...by.values()].sort((a, b) => b.run_date.localeCompare(a.run_date) || a.driver_name.localeCompare(b.driver_name, "fa"));
}

/** «۷ ساعت و ۳۰ دقیقه», «۴۵ دقیقه»; «—» when nothing finished. */
export function hoursLabel(minutes: number): string {
  if (minutes <= 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const fa = (n: number) => n.toLocaleString("fa-IR");
  return [h > 0 ? `${fa(h)} ساعت` : null, m > 0 ? `${fa(m)} دقیقه` : null].filter(Boolean).join(" و ");
}
