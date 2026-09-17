"use client";

import { useCallback, useEffect, useRef } from "react";
import { OUTBOX_HOLD_MS } from "@/lib/offline/constants";

/** The 5-second undo: a finished flow's POST is held client-side, so undo never has to
 *  reverse a server write. Leaving the page (a tel: call, a tab switch, closing) sends it
 *  at once -- a held save is never lost. One held save at a time; a new hold sends the old. */
export function useHeldSave() {
  const pending = useRef<{ timer: number; run: () => Promise<void> } | null>(null);

  const flush = useCallback(async () => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    window.clearTimeout(p.timer);
    await p.run();
  }, []);

  const hold = useCallback((run: () => Promise<void>) => {
    void flush();
    const timer = window.setTimeout(() => {
      const p = pending.current;
      pending.current = null;
      if (p) void p.run();
    }, OUTBOX_HOLD_MS);
    pending.current = { timer, run };
  }, [flush]);

  const cancel = useCallback((): boolean => {
    const p = pending.current;
    if (!p) return false;
    window.clearTimeout(p.timer);
    pending.current = null;
    return true;
  }, []);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") void flush(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      document.removeEventListener("pagehide", onHide);
    };
  }, [flush]);

  return { hold, cancel, flush };
}
