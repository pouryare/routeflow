"use client";

import { Icon, type IconName } from "@/components/meridian/Icon";

/** The one dominant action of a page, pinned above the bottom bar on a phone so the thumb never
 *  has to scroll to it (the order form's «ثبت سفارش», the planner's confirm). From md up it is
 *  an ordinary button in the flow. Reserve its height with `.sticky-action-gap` on the page. */
export default function StickyAction({ label, icon = "check", onClick, disabled, busy }: {
  label: string;
  icon?: IconName;
  onClick: () => void;
  disabled?: boolean;
  /** Shown instead of the label while the action runs, so the button never just goes dead. */
  busy?: string;
}) {
  return (
    <div className="sticky-action">
      <button type="button" className="sticky-action__btn" disabled={disabled} onClick={onClick}>
        <Icon name={icon} size="md" />
        {busy ?? label}
      </button>
    </div>
  );
}
