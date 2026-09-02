"use client";

import { useEffect, useState } from "react";

/** True when the OS asks for reduced motion.
 *
 *  SSR-safe: `false` until mounted, so the server and the first client paint agree, then
 *  it subscribes to the media query and re-renders if the answer is different or later
 *  changes. Every animation in /sales checks this (or the CSS `@media
 *  (prefers-reduced-motion: no-preference)` equivalent) and falls back to the finished
 *  state with no transition.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return reduced;
}
