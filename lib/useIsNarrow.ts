"use client";

import { useEffect, useState } from "react";

/** A phone-sized or touch-first screen. Shared so every page that swaps a desk control for a
 *  phone one (the board's pager, the reminder sheet) uses the same definition of "phone".
 *  False on the server and on first paint, true after mount on a phone. */
export function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 620px), (pointer: coarse)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}
