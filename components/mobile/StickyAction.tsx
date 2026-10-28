"use client";

import { type IconName } from "@/components/meridian/Icon";
import BusyIcon from "@/components/meridian/BusyIcon";

/** The one dominant action of a page, pinned above the bottom bar on a phone so the thumb never
 *  has to scroll to it (the order form's «ثبت سفارش», the planner's confirm). From md up it is
 *  an ordinary button in the flow. Reserve its height with `.sticky-action-gap` on the page. */
export default function StickyAction({ label, icon = "check", onClick, disabled, busy, done }: {
  label: string;
  icon?: IconName;
  onClick: () => void;
  disabled?: boolean;
  /** Shown instead of the label while the action runs, so the button never just goes dead. */
  busy?: string;
  /** Shown (with a check mark) for a moment after the action succeeded. */
  done?: string;
}) {
  return (
    <div className="sticky-action">
      <button type="button" className="sticky-action__btn" disabled={disabled} onClick={onClick}>
        <BusyIcon busy={!!busy} done={!!done} name={icon} />
        {busy ?? done ?? label}
      </button>
    </div>
  );
}
