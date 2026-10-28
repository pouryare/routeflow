"use client";

import { useEffect } from "react";
import { useLatest } from "@/lib/useLatest";

/** The phone's back button (or back gesture) closes the open sheet or overlay instead of
 *  leaving the page.
 *
 *  Opening pushes a history entry tagged with the overlay's id; back pops it, and the
 *  popstate closes the overlay. Closing any other way (the close button, a drag, a save)
 *  pops the entry again so the history does not fill with dead steps. When the overlay
 *  closes because a link inside it navigated, the entry is no longer on top and is left
 *  behind: a later back that lands on it skips over it (see onPop). Next.js copies its own
 *  router state into a pushState call, so its back/forward keeps working around ours. */

const KEY = "rfOverlay";
const openIds = new Set<string>();
const listening = new WeakSet<object>();

type Hist = Pick<History, "state" | "pushState" | "back">;

function overlayId(state: unknown): string | undefined {
  return (state as Record<string, unknown> | null)?.[KEY] as string | undefined;
}

/** Back landed on an entry whose overlay already closed (left behind by a navigation): step
 *  over it so one press of back always does something visible. */
function onPop(hist: Hist) {
  const id = overlayId(hist.state);
  if (id && !openIds.has(id)) hist.back();
}

/** Pushes the entry and returns the release for when the overlay closes. Exported for tests. */
/** `close` may return false to stay open (a sheet asking before it drops unsaved input): the
 *  entry is pushed again, so the next back asks the same overlay once more. */
export function trapBack(hist: Hist, target: Pick<Window, "addEventListener" | "removeEventListener">, close: () => boolean | void): () => void {
  if (!listening.has(target)) {
    target.addEventListener("popstate", () => onPop(hist));
    listening.add(target);
  }
  const id = Math.random().toString(36).slice(2);
  openIds.add(id);
  hist.pushState({ ...(hist.state ?? {}), [KEY]: id }, "");
  let popped = false;
  const pop = () => {
    // Back moved off our entry (to the one below it): the overlay closes.
    if (overlayId(hist.state) !== id && openIds.has(id)) {
      if (close() === false) {
        hist.pushState({ ...(hist.state ?? {}), [KEY]: id }, "");
        return;
      }
      popped = true;
      openIds.delete(id);
    }
  };
  target.addEventListener("popstate", pop);
  return () => {
    target.removeEventListener("popstate", pop);
    openIds.delete(id);
    if (!popped && overlayId(hist.state) === id) hist.back();
  };
}

export function useBackToClose(open: boolean, onClose: () => boolean | void): void {
  const close = useLatest(onClose);
  useEffect(() => {
    if (!open) return;
    let release: (() => void) | undefined;
    // Pushed a tick late so React's dev double-run (mount, unmount, mount) cancels the first
    // one before it touches history, instead of pushing and popping a stray entry.
    const t = setTimeout(() => { release = trapBack(window.history, window, () => close.current()); }, 0);
    return () => { clearTimeout(t); release?.(); };
  }, [open, close]);
}
