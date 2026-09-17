"use client";

import { useCallback, useEffect, useRef } from "react";
import { telHref } from "@/lib/crm/phone";

/** Tap Call → the dialler opens → when the rep comes back, `onReturn(id)` opens the
 *  after-call flow. On a desktop the page never hides, so it opens after 1.5 s instead. */
export function useCallReturn(onReturn: (customerId: number) => void) {
  const pending = useRef<number | null>(null);
  const cb = useRef(onReturn);
  useEffect(() => { cb.current = onReturn; });

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && pending.current !== null) {
        const id = pending.current;
        pending.current = null;
        cb.current(id);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  return useCallback((customerId: number, phoneNorm: string) => {
    pending.current = customerId;
    window.location.href = telHref(phoneNorm);
    window.setTimeout(() => {
      if (pending.current === customerId && document.visibilityState === "visible") {
        pending.current = null;
        cb.current(customerId);
      }
    }, 1500);
  }, []);
}
