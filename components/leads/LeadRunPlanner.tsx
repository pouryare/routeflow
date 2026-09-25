"use client";

import { useCallback, useEffect, useState } from "react";
import JalaliDateInput from "@/components/meridian/JalaliDateInput";
import { Icon } from "@/components/meridian/Icon";
import { faNum } from "@/lib/format";
import { todayJalali, jalaliToIsoDate } from "@/lib/jalali";
import type { LeadRun } from "@/lib/repo/leadRuns";

/** Hand the run you have just built to a driver, for a day.
 *
 *  This is the step that makes a route real. Everything before it is a manager's private
 *  scratch run in the browser; a driver cannot see any of it, so until it is assigned here
 *  the work exists only on one screen.
 *
 *  The date field is Jalali and the value is ISO, because JalaliDateInput already does that
 *  conversion. Doing it here instead would be the Jalali/Gregorian mismatch the repo layer
 *  refuses: a run stored as ۱۴۰۵-۰۷-۰۱ sorts against real dates as far in the past, and the
 *  driver simply never sees the day.
 *
 *  Drivers come from the server, not from a guess: an inactive account or somebody from
 *  another group is not offered, which is how a route disappears without anyone noticing.
 */
export default function LeadRunPlanner({
  locationIds,
  busy,
  onAssigned,
}: {
  locationIds: number[];
  busy?: boolean;
  onAssigned?: (run: LeadRun) => void;
}) {
  const [drivers, setDrivers] = useState<Array<{ id: number; name: string }>>([]);
  const [driverId, setDriverId] = useState<number | "">("");
  const [runDate, setRunDate] = useState<string>(() => {
    const t = todayJalali();
    return jalaliToIsoDate(t.jy, t.jm, t.jd);
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/lead-runs?drivers=1");
        const data = await res.json();
        if (cancelled || !data.ok) return;
        setDrivers(data.drivers ?? []);
        // Preselect when there is exactly one driver, which is the small-team case and
        // saves a tap without ever guessing between several people.
        if ((data.drivers ?? []).length === 1) setDriverId(data.drivers[0].id);
      } catch { /* the select simply stays empty */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const assign = useCallback(async () => {
    if (driverId === "" || locationIds.length === 0) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/lead-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driver_user_id: driverId, run_date: runDate, location_ids: locationIds }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error ?? "ثبت مسیر انجام نشد");
      setMessage({
        tone: "ok",
        // reused=true means that driver already had a run that day and this re-used it.
        // Saying so matters: the alternative reading is "a second route was created".
        text: data.reused
          ? "برای این راننده در این تاریخ مسیری وجود داشت و همین مسیر به‌روز شد."
          : "مسیر ثبت شد و به راننده سپرده شد.",
      });
      onAssigned?.(data.run);
    } catch (e) {
      setMessage({ tone: "bad", text: e instanceof Error ? e.message : "خطا" });
    } finally {
      setSaving(false);
    }
  }, [driverId, locationIds, onAssigned, runDate]);

  if (locationIds.length === 0) return null;

  return (
    <section className="rounded-[var(--radius-lg)] border border-border bg-surface-raised p-4">
      <div className="mb-3 flex items-center gap-2">
        <Icon name="route" size="md" className="text-accent" />
        <h2 className="text-[length:var(--text-md)] font-semibold text-text">سپردن مسیر به راننده</h2>
      </div>

      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[length:var(--text-xs)] text-text-faint">راننده</span>
          <select
            className="input"
            value={driverId}
            onChange={(e) => setDriverId(e.target.value === "" ? "" : Number(e.target.value))}
          >
            <option value="">انتخاب راننده…</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[length:var(--text-xs)] text-text-faint">تاریخ</span>
          <JalaliDateInput value={runDate} onChange={setRunDate} />
        </label>

        <p className="text-[length:var(--text-xs)] text-text-faint">
          {faNum(locationIds.length)} توقف
        </p>

        <button
          type="button"
          className="btn solid"
          disabled={saving || busy || driverId === ""}
          onClick={() => void assign()}
        >
          {saving ? "در حال ثبت…" : "ثبت و سپردن"}
        </button>

        {message ? (
          <p className={`text-[length:var(--text-xs)] ${message.tone === "ok" ? "text-ok" : "text-crit"}`}>
            {message.text}
          </p>
        ) : null}
      </div>
    </section>
  );
}
