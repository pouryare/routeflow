"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const FEEDBACK_MS = 100;

/** Choice feedback: the tapped option lights up for a beat before the flow advances, so the
 *  tap is acknowledged even though the next question replaces the screen. A second tap while
 *  the first is still showing is ignored, and unmounting cancels the pending advance.
 *
 *  The timer is scheduled in the event handler, NOT inside the state updater: StrictMode
 *  double-invokes updater functions, which armed two timers and submitted every choice
 *  twice (duplicate save, duplicate toast). The busy ref guards synchronously. */
export function useChoiceFeedback(): { selected: string | null; choose: (id: string, submit: (id: string) => void) => void } {
  const [selected, setSelected] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const busy = useRef(false);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  const choose = useCallback((id: string, submit: (id: string) => void) => {
    if (busy.current) return;
    busy.current = true;
    setSelected(id);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      busy.current = false;
      setSelected(null);
      submit(id);
    }, FEEDBACK_MS);
  }, []);
  return { selected, choose };
}