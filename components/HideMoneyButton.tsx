"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Icon } from "@/components/meridian/Icon";
import { HIDE_MONEY_KEY, parseHideMoney } from "@/lib/hideMoney";

const apply = (hidden: boolean) => {
  if (hidden) document.documentElement.dataset.hideMoney = "1";
  else delete document.documentElement.dataset.hideMoney;
};

// The choice lives outside React (this device's storage), so it is read as an external store
// rather than copied into state from an effect.
const listeners = new Set<() => void>();
let current: boolean | null = null;
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};
const read = () => {
  if (current === null) {
    try {
      current = parseHideMoney(localStorage.getItem(HIDE_MONEY_KEY));
    } catch {
      current = false; /* storage blocked: shown */
    }
  }
  return current;
};

/** The eye that hides every rolling money figure on the screen (CountUp), for showing the phone to
 *  someone. Tap to hide or show; while hidden, holding the button peeks. The choice is kept on this
 *  device only. */
export default function HideMoneyButton() {
  const hidden = useSyncExternalStore(subscribe, read, () => false);
  useEffect(() => apply(hidden), [hidden]);
  const set = (h: boolean) => {
    current = h;
    try {
      localStorage.setItem(HIDE_MONEY_KEY, h ? "1" : "0");
    } catch {
      /* not kept */
    }
    listeners.forEach((l) => l());
  };
  return (
    <button
      type="button"
      className="touch hidemoney"
      aria-pressed={hidden}
      aria-label={hidden ? "نمایش مبلغ‌ها" : "پنهان کردن مبلغ‌ها"}
      onClick={() => set(!hidden)}
      onPointerDown={() => hidden && delete document.documentElement.dataset.hideMoney}
      onPointerUp={() => hidden && apply(true)}
      onPointerLeave={() => hidden && apply(true)}
    >
      <Icon name={hidden ? "eye-off" : "eye"} size="md" />
    </button>
  );
}
