"use client";

import { useEffect } from "react";

/** Call `onEscape` when Escape is pressed anywhere on the page, while `enabled`.
 *
 *  For overlays that close on Escape and need nothing else from the key: a handler that
 *  also traps focus or stops propagation is a different animal and keeps its own listener. */
export function useEscapeKey(onEscape: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onEscape();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, onEscape]);
}
