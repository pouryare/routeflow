"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import { HIDE_MONEY_KEY, parseHideMoney } from "@/lib/hideMoney";

const apply = (hidden: boolean) => {
  if (hidden) document.documentElement.dataset.hideMoney = "1";
  else delete document.documentElement.dataset.hideMoney;
};

/** The eye that hides every rolling money figure on the screen (CountUp), for showing the phone to
 *  someone. Tap to hide or show; while hidden, holding the button peeks. The choice is kept on this
 *  device only. */
export default function HideMoneyButton() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    try {
      const h = parseHideMoney(localStorage.getItem(HIDE_MONEY_KEY));
      setHidden(h);
      apply(h);
    } catch {
      /* storage blocked: shown */
    }
  }, []);
  const set = (h: boolean) => {
    setHidden(h);
    apply(h);
    try {
      localStorage.setItem(HIDE_MONEY_KEY, h ? "1" : "0");
    } catch {
      /* not kept */
    }
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
