"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";

/** The sticky top chrome -- brand bar + both nav rows -- that slides up out of view on a
 *  downward scroll and back on an upward one, the way a mobile browser toolbar does.
 *  Only a class toggle here; all geometry is in `.kargah .chrome` in globals.css.
 *
 *  RTL: the motion is translateY, identical in both writing directions.
 *  Reduced motion: `.chrome-hidden` is never applied and the CSS transition is zeroed.
 *  RevealRoute / RouteFade animate the CONTENT; this animates the CHROME and only reads
 *  scrollY -- they never touch the same node. A route change re-runs the effect below,
 *  which reveals the chrome, so a new page never opens with the nav hidden.
 */
const TOP_GUARD = 64; // never hide within this many px of the top
const DOWN_PX = 12; // downward travel before committing to hide
const UP_PX = 6; // upward travel before revealing

export default function Chrome({ children }: { children: ReactNode }) {
  const reduced = usePrefersReducedMotion();
  const pathname = usePathname();
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    // Reveal on mount / route change / reduced-motion toggle -- async (rAF), so this is
    // not a synchronous setState in the effect body.
    const revealRaf = requestAnimationFrame(() => setHidden(false));
    if (reduced) return () => cancelAnimationFrame(revealRaf);

    let last = window.scrollY;
    let anchor = last;
    let dir: 1 | -1 | 0 = 0;
    let queued = false;

    const evaluate = () => {
      queued = false;
      const y = window.scrollY;
      const delta = y - last;
      last = y;
      if (delta === 0) return;

      const nextDir = delta > 0 ? 1 : -1;
      if (nextDir !== dir) {
        dir = nextDir;
        anchor = y;
      }
      const travel = Math.abs(y - anchor);

      if (y <= TOP_GUARD) setHidden(false);
      else if (dir === 1 && travel > DOWN_PX) setHidden(true);
      else if (dir === -1 && travel > UP_PX) setHidden(false);
    };

    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(evaluate);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(revealRaf);
      window.removeEventListener("scroll", onScroll);
    };
  }, [reduced, pathname]);

  return <div className={`chrome${hidden ? " chrome-hidden" : ""}`}>{children}</div>;
}
