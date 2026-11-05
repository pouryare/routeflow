"use client";

import { useCallback, useState } from "react";
import Coin from "@/components/meridian/Coin";
import { useRunAfterMount } from "@/lib/useRunAfterMount";

const KEY = "rf-earnings-seen";

/** The coin on the earnings card turns once when the accrued commission is higher than the last time this
 *  phone showed it (the figure itself is server-rendered; the last figure seen is a convenience kept per phone). */
export default function EarningsCoin({ accrued }: { accrued: number }) {
  const [spin, setSpin] = useState(0);
  const check = useCallback(() => {
    try {
      const seen = Number(localStorage.getItem(KEY) ?? "0");
      if (accrued > seen) setSpin(1);
      localStorage.setItem(KEY, String(accrued));
    } catch {
      // no storage: the coin simply stays still
    }
  }, [accrued]);
  useRunAfterMount(check);
  return <Coin spinKey={spin} />;
}
