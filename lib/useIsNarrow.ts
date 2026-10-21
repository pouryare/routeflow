"use client";

import { useSyncExternalStore } from "react";

/** What "a phone" means everywhere: a narrow screen, or a touch-first one. The same string is
 *  used by the CSS that swaps layouts (`.board-mobile` / `.board-desktop` in globals.css), so
 *  behaviour and layout cannot disagree about which device this is. */
export const NARROW_QUERY = "(max-width: 620px), (pointer: coarse)";

function subscribe(notify: () => void): () => void {
  const mq = window.matchMedia(NARROW_QUERY);
  mq.addEventListener("change", notify);
  return () => mq.removeEventListener("change", notify);
}

const snapshot = () => window.matchMedia(NARROW_QUERY).matches;

/** True on a phone-sized or touch-first screen.
 *
 *  `useSyncExternalStore` reads the media query directly, so the first client render already has
 *  the right answer -- the old effect-and-state version painted `false` first and corrected it a
 *  frame later, which a phone showed as the desk control flashing before the phone one.
 *  Use it for BEHAVIOUR (which handler a button runs, which sheet opens). For LAYOUT use CSS: the
 *  server cannot know the device, so only a media query can avoid a wrong first paint. */
export function useIsNarrow(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
