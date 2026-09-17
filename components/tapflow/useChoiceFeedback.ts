"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const FEEDBACK_MS = 100;

/** Choice feedback: the tapped option lights up for a beat before the flow advances, so the
 *  tap is acknowledged even though the next question replaces the screen. A second tap while
 *  the first is still showing is ignored, and unmounting cancels the pending advance. */
export function useChoiceFeedback(): { selected: string | null; choose: (id: string, submit: (id: string) => void) => void } {
  const [selected, setSelected] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  const choose = useCallback((id: string, submit: (id: string) => void) => {
    setSelected((cur) => {
      if (cur !== null) return cur;
      timer.current = window.setTimeout(() => {
        timer.current = null;
        setSelected(null);
        submit(id);
      }, FEEDBACK_MS);
      return id;
    });
  }, []);
  return { selected, choose };
}