"use client";

import { Icon } from "@/components/meridian/Icon";
import { faNum } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import type { DriverStop } from "@/components/driver/useDriverRun";

/** What the driver needs to know before they get out of the van.
 *
 *  Two blocks here exist nowhere else in the app, and both come from the visit history the
 *  driver is the only one who can act on:
 *
 *  - the last visit's outcome, so they do not walk in blind;
 *  - a call that was promised and never made. The lead that generated it belongs to phone
 *    sales now, and the driver is standing in front of that very door. No manager screen
 *    surfaces this at the moment it could still be saved.
 */

const LAST_VISIT: Record<string, string> = {
  VISITED: "بازدید انجام شد",
  ACCESS_FAILED: "دسترسی ممکن نشد",
  READY_TO_BUY: "آماده خرید",
  INTERESTED: "علاقه‌مند ولی نیاز به تماس",
  VISIT_CLOSED: "بسته بود",
  VISIT_NO_OWNER: "صاحب‌ش نبود",
  VISIT_WRONG_ADDRESS: "آدرس اشتباه",
  VISIT_NEW_BUILDING: "ساخته جدید",
};

export default function NextStopBanner({
  stop,
  index,
  total,
  runDate,
  km,
  onRecord,
}: {
  stop: DriverStop | null;
  index: number;
  total: number;
  runDate: string;
  km: number | null;
  onRecord: (locationId: number) => void;
}) {
  if (!stop) {
    return (
      <section className="rounded-[var(--radius-lg)] border border-border bg-surface-raised p-4">
        <div className="flex items-center gap-3">
          <Icon name="check" size="lg" className="text-ok" />
          <div>
            <p className="font-medium text-text">مسیر امروز تمام شد</p>
            <p className="text-[length:var(--text-xs)] text-text-faint">
              {faNum(total)} توقف ثبت شده{faJalaliDate(runDate) ? ` · ${faJalaliDate(runDate)}` : ""}
            </p>
          </div>
        </div>
      </section>
    );
  }

  const lastOutcome = stop.visit_outcome ? LAST_VISIT[stop.visit_outcome] : null;
  // A lead handed to phone sales is no longer this driver's to chase, but saying so here is
  // the difference between "the app lost my stop" and "this moved on".
  const awaitingCall = stop.next_action === "call";

  return (
    <section className="rounded-[var(--radius-lg)] border border-accent bg-accent/10 p-4">
      <div className="flex items-start gap-3">
        <Icon name="compass" size="lg" className="text-accent" />
        <div className="min-w-0 flex-1">
          <p className="text-[length:var(--text-xs)] text-accent">توقف بعدی</p>
          <p className="truncate text-[length:var(--text-lg)] font-bold text-text">{stop.name}</p>
          {stop.address ? <p className="truncate text-[length:var(--text-xs)] text-text-faint">{stop.address}</p> : null}
          <p className="mt-1 text-[length:var(--text-xs)] text-text-faint">
            توقف {faNum(index)} از {faNum(total)}
            {km !== null ? ` · ${faNum(Math.round(km * 10) / 10)} کیلومتر` : ""}
            {faJalaliDate(runDate) ? ` · ${faJalaliDate(runDate)}` : ""}
          </p>
        </div>
      </div>

      {lastOutcome ? (
        <p className="mt-3 rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2 text-[length:var(--text-xs)] text-text-muted">
          دفعهٔ قبل — {lastOutcome}
        </p>
      ) : null}

      {awaitingCall ? (
        <p className="mt-2 flex items-start gap-2 rounded-[var(--radius-sm)] border border-warn/40 bg-warn/10 px-3 py-2 text-[length:var(--text-xs)] text-warn">
          <Icon name="phone" size="sm" />
          <span>این سرنخ برای تماس به فروش تلفنی سپرده شده — پیگیری‌اش با دفتر است.</span>
        </p>
      ) : null}

      <button
        type="button"
        className="inline-flex items-center justify-center gap-[var(--space-2)] btn solid mt-3 w-full"
        onClick={() => onRecord(stop.location_id)}
      >
        <Icon name="check" size="md" />
        رسیدم — ثبت نتیجه
      </button>
    </section>
  );
}
