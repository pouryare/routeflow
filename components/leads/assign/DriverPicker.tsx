"use client";

import Avatar from "@/components/meridian/Avatar";
import { Icon } from "@/components/meridian/Icon";
import { busyLabel, type DriverRef } from "@/lib/leadRunAssign";
import type { LeadRunStatus } from "@/lib/repo/leadRuns";

/** Who is taking the route.
 *
 *  Not a dropdown: a manager is handing a day's work to a person, and a face they can
 *  recognise beats a closed dropdown they have to open to read. The count of days each
 *  driver already holds is on the card, so someone with a free week is visible before the
 *  calendar is ever opened rather than discovered by hunting through a month. */
export default function DriverPicker({
  drivers,
  busy,
  selectedId,
  onSelect,
}: {
  drivers: DriverRef[];
  /** `busyDatesByDriver` output. */
  busy: Map<number, Map<string, LeadRunStatus>>;
  selectedId: number | "";
  onSelect: (id: number) => void;
}) {
  if (drivers.length === 0) {
    return (
      <p className="tf-note">
        راننده‌ای برای سپردن مسیر ثبت نشده است. یک حساب راننده در تنظیمات بسازید.
      </p>
    );
  }

  return (
    <div className="tf-grid people">
      {drivers.map((d) => {
        const days = busy.get(d.id)?.size ?? 0;
        const meta = busyLabel(days);
        return (
          <button
            key={d.id}
            type="button"
            className={`tf-opt tf-person${selectedId === d.id ? " on" : ""}`}
            aria-pressed={selectedId === d.id}
            title={d.name}
            onClick={() => onSelect(d.id)}
          >
            <Icon name="truck" size="md" />
            <Avatar userId={d.id} name={d.name} src={d.avatar_url} size={34} />
            <span className="tf-person__text">
              <span className="tf-person__name">{d.name}</span>
              {meta ? <span className="tf-person__meta">{meta}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
