"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  if (typeof matchMedia !== "function") return () => {};
  const mq = matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return typeof matchMedia === "function" && matchMedia(QUERY).matches;
}

/** True when the OS asks for reduced motion.
 *
 *  SSR-safe: `false` on the server and the hydrating render, so the two agree, then the
 *  browser's answer, kept current by the media query's change event. Every animation in
 *  /sales checks this (or the CSS `@media (prefers-reduced-motion: no-preference)`
 *  equivalent) and falls back to the finished state with no transition.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
