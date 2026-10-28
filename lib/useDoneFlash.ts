"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buzz } from "@/lib/haptic";

/** How long the check mark stays on a button after its action succeeded. */
export const DONE_FLASH_MS = 1100;

/** `[done, flash]`: call `flash()` when an action just succeeded; `done` is true for a
 *  moment so the button can show a check mark (`BusyIcon done`) and buzz the phone once. */
export function useDoneFlash(): [boolean, () => void] {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const flash = useCallback(() => {
    buzz();
    setDone(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), DONE_FLASH_MS);
  }, []);
  return [done, flash];
}
