"use client";

import Avatar from "@/components/meridian/Avatar";
import { summaryOf } from "@/lib/leadRunAssign";

/** What is about to be applied, or what was just applied.
 *
 *  Shown on the confirm screen and again on the done panel, from the same call, so the two
 *  can never disagree about what happened. `tap-flow-principles.md` §8 lists "silent
 *  defaults -- a value applied without appearing on the final summary" as an anti-pattern;
 *  this is the answer to it, and the reason the driver and the date are both here rather
 *  than only in the steps before. */
export default function RunSummary({
  driverId,
  driverName,
  driverAvatar,
  runDate,
  stopCount,
}: {
  driverId?: number;
  driverName: string | null;
  driverAvatar?: string | null;
  runDate: string;
  stopCount: number;
}) {
  const [, dateLine, stopLine] = summaryOf({ driverName, runDate, stopCount });

  return (
    <div className="tf-card">
      <div className="flex items-center justify-center gap-2">
        <Avatar userId={driverId} name={driverName ?? ""} src={driverAvatar} size={34} />
        <div className="min-w-0 text-center">
          <p className="truncate text-[length:var(--text-sm)] font-medium text-text">
            {driverName ?? "راننده انتخاب نشده"}
          </p>
          <p className="text-[length:var(--text-xs)] text-text-faint">{stopLine}</p>
        </div>
      </div>
      <p className="text-center text-[length:var(--text-xs)] text-text-muted">{dateLine}</p>
    </div>
  );
}
