"use client";

import { useCallback, useEffect, useRef } from "react";
import { REPEAT_FIRST_MS, repeatInterval } from "@/lib/repeatPress";
import { useLatest } from "@/lib/useLatest";

/** Press handlers that run `step` once on press, and keep running it while the finger (or Space or
 *  Enter) stays down: a count of 40 cartons is a hold, not 40 taps. Give them to a React Aria
 *  button as `onPressStart` and `onPressEnd`, not `onPress`, or a tap would count twice. */
export function useRepeatPress(step: () => void) {
  const latest = useLatest(step);
  const timer = useRef<number | null>(null);
  const stop = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const start = useCallback(() => {
    stop();
    latest.current?.();
    let n = 0;
    const tick = () => {
      latest.current?.();
      timer.current = window.setTimeout(tick, repeatInterval(++n));
    };
    timer.current = window.setTimeout(tick, REPEAT_FIRST_MS);
  }, [latest, stop]);
  useEffect(() => stop, [stop]);
  return { onPressStart: start, onPressEnd: stop };
}
