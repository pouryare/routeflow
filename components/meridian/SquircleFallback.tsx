"use client";

import { useEffect } from "react";
import {
  SQUIRCLE_SELECTORS,
  isPillRadius,
  parseCornerRadius,
  superellipsePath,
  supportsCornerShape,
} from "@/lib/squircle";

/** Draws the squircle corner on browsers that cannot.
 *
 *  `corner-shape` is in Chrome/Edge 139+ and Safari's preview, but not in Firefox, so
 *  roughly 29% of users would otherwise see a plain arc while everyone else sees a
 *  squircle. This paints the same corner with a `clip-path`, so the shape is the same
 *  everywhere rather than merely better on some machines.
 *
 *  On a browser with native support this component renders null and costs nothing: no
 *  DOM, no observers, no measurement. That is the common case and the point.
 *
 *  `?force=1` (or a `localStorage` flag) mounts the fallback anyway, so the clipped path
 *  can be inspected in the browser you actually develop in. Without it the fallback is
 *  invisible on 71% of machines, which is the same as unmaintainable.
 */
export default function SquircleFallback() {
  useEffect(() => {
    if (!shouldRunFallback()) return;

    const root = document.querySelector(".meridian") ?? document.body;
    const nodes = Array.from(root.querySelectorAll<HTMLElement>(SELECTOR_STRING));

    /** Measure one element and write its clip, or clear it if it no longer qualifies. */
    const apply = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      // A collapsed element has no box to trace; clearing beats writing a broken path.
      if (rect.width === 0 || rect.height === 0) {
        el.style.removeProperty("--sq-clip");
        return;
      }

      const radius = parseCornerRadius(getComputedStyle(el).borderRadius);
      // Unreadable radius or a pill: a squircle is invisible on a pill, so leave it be.
      if (radius === null || isPillRadius(radius, rect.width, rect.height)) {
        el.style.removeProperty("--sq-clip");
        return;
      }

      el.style.setProperty("--sq-clip", `path("${superellipsePath(rect.width, rect.height, radius)}")`);
    };

    nodes.forEach(apply);

    /* Only width/height changes alter the path. Watching the box and comparing to the
       last-seen size means the RevealRoute entrance -- which only animates transform and
       opacity -- never wakes this up, and a scroll does not either. */
    const sizes = new Map<HTMLElement, string>();
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const key = `${Math.round(entry.contentRect.width)}x${Math.round(entry.contentRect.height)}`;
        if (sizes.get(el) === key) continue;
        sizes.set(el, key);
        apply(el);
      }
    });
    nodes.forEach((el) => {
      const r = el.getBoundingClientRect();
      sizes.set(el, `${Math.round(r.width)}x${Math.round(r.height)}`);
      observer.observe(el);
    });

    return () => {
      observer.disconnect();
      nodes.forEach((el) => el.style.removeProperty("--sq-clip"));
    };
  }, []);

  return null;
}

/** The list, joined once. Kept beside the list so the two cannot drift. */
const SELECTOR_STRING = SQUIRCLE_SELECTORS.join(", ");

/** Native support wins, unless someone is explicitly inspecting the fallback. */
function shouldRunFallback(): boolean {
  if (typeof window === "undefined") return false;
  if (isForced()) return true;
  return !supportsCornerShape();
}

/** `?force=1` in the URL, or a sticky localStorage flag for inspecting without the query. */
function isForced(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("force") === "1") {
      window.localStorage.setItem("squircle:force", "1");
      return true;
    }
    return window.localStorage.getItem("squircle:force") === "1";
  } catch {
    // Private mode can throw on localStorage; the query param alone is enough.
    return false;
  }
}
