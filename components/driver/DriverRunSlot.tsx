"use client";

import type { ComponentProps } from "react";
import DriverRun from "./DriverRun";
import { useTutorialData, useTutorials } from "@/components/tutorials/TutorialProvider";
import type { RunDetail } from "@/lib/delivery";

/** Today's run, or the demo run while a driver tutorial runs (even on a day with no real run, which
 *  is exactly a new driver's first day). Ending the tutorial puts the real run back without a reload. */
export default function DriverRunSlot({ run, ...rest }: Omit<ComponentProps<typeof DriverRun>, "run"> & { run: RunDetail | null }) {
  const shown = useTutorialData<RunDetail | null>("driver-run", run);
  // A fresh run when the ghost demo hands over («حالا شما»): the stop it opened starts closed again.
  const mode = useTutorials().active?.mode;
  if (!shown || shown.stops.length === 0) {
    /* An EMPTY section, not a missing one. A driver must never read this as "there are no
       deliveries" when the truth is that the section did not render. */
    return (
      <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border)] p-[var(--space-6)] text-center text-[length:var(--text-sm)] leading-7 text-[var(--text-faint)]">
        امروز مسیری برای شما ثبت نشده است. وقتی مدیر سفارش‌ها را به مسیر شما اضافه کند، همین‌جا نمایش داده می‌شود.
      </p>
    );
  }
  return <DriverRun key={`${shown.id}:${mode ?? ""}`} run={shown} {...rest} />;
}
