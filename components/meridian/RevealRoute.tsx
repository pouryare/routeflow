"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/** What counts as "a card" differs per screen, so they are NAMED rather than guessed at
 *  with one selector.
 *
 *  Guessing is what produced the bug this replaces: a selector broad enough to catch
 *  every card also catches a card's own container, and the two then animate on separate
 *  clocks — a block fading in while the pockets inside it are still fading in. Naming
 *  each screen's list also makes a missing screen obvious, which is how the board came to
 *  have no entrance at all.
 *
 *  Longest-prefix match, so /sales/orders/12 uses the orders list.
 */
const REVEAL: Record<string, string[]> = {
  "/sales": [".gcard", ".kblock", ".cradlewrap"],
  "/sales/orders": [".bhead", ".pocket"],
  "/sales/orders/new": [".card", ".kblock"],
  "/sales/board": [".hint", ".col"],
  "/sales/journey": [".bhead", ".lane2"],
  "/sales/schedule": [".notice", ".sched > .kblock"],
  "/sales/dashboard": [".gcard", ".dash-top > .card", ".sect"],
  "/sales/products": [".card", ".kblock"],
  "/sales/commission": [".card", ".kblock"],
  "/sales/stock": [".gcard", ".stalert", ".stcard", ".card"],
  "/sales/runs": [".card", ".kblock", ".run-column"],
  "/sales/admin/users": [".card", ".kblock"],
  "/sales/admin/groups": [".card", ".kblock"],
};

/** Milliseconds between one card and the next. */
const STAGGER = 38;
/** Above this many cards the lift is dropped for a plain fade.
 *
 *  The spring overshoots by design — each card passes its resting place and settles back.
 *  On three headline cards that is liveliness; on a grid of twelve order pockets it is
 *  twelve things wobbling at once. Six is where it stops reading as one gesture. */
const LIFT_MAX = 6;
/** Past this many the stagger stops reading as rhythm and starts reading as lag, so the
 *  delay stops growing rather than the cards stopping. */
const CAP = 8;
/** `--ease` and `--spring` from app/globals.css. The Web Animations API takes an easing
 *  string, not a custom property, so they are repeated here. */
const EASE = "cubic-bezier(.16,1,.3,1)";
const SPRING = "cubic-bezier(.34,1.32,.5,1)";

function selectorsFor(pathname: string): string[] {
  const key = Object.keys(REVEAL)
    .filter((k) => pathname === k || pathname.startsWith(`${k}/`))
    .sort((a, b) => b.length - a.length)[0];
  return REVEAL[key ?? "/sales"] ?? [];
}

/** The entrance, for every sales screen, from one place.
 *
 *  Lives in the layout rather than in each page: wiring it per page is what let three
 *  screens drift — one with no entrance, one animating its list but not its header.
 *
 *  **Web Animations, not classes.** This effect runs when the layout hydrates, which is
 *  before the page below it (inside its own Suspense boundary) has. It used to add
 *  `rev rev-in` classes and an inline transition-delay to those cards, so React then
 *  hydrated a page whose className and style no longer matched the server's, and logged
 *  a hydration error on every sales screen. `el.animate()` touches no attribute, so there
 *  is nothing to mismatch; `fill: "backwards"` holds the hidden first frame through the
 *  stagger delay, and a finished animation removes itself, so it can never outlive the
 *  entrance and override a card's own hover transition.
 */
export default function RevealRoute() {
  const pathname = usePathname();

  useEffect(() => {
    const selectors = selectorsFor(pathname);
    if (!selectors.length) return;
    if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const items: HTMLElement[] = [];
    for (const sel of selectors) {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
        // A card already claimed by an earlier selector must not be staggered twice.
        if (!items.includes(el)) items.push(el);
      }
    }
    if (!items.length || typeof items[0].animate !== "function") return;

    const lift = items.length <= LIFT_MAX;
    const running: Animation[] = [];
    items.forEach((el, i) => {
      const delay = Math.min(i, CAP) * STAGGER;
      running.push(
        el.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: lift ? 460 : 300,
          easing: EASE,
          delay,
          fill: "backwards",
        }),
      );
      if (lift) {
        running.push(
          el.animate([{ transform: "translateY(16px)" }, { transform: "none" }], {
            duration: 620,
            easing: SPRING,
            delay,
            fill: "backwards",
          }),
        );
      }
    });

    return () => running.forEach((a) => a.cancel());
  }, [pathname]);

  return null;
}
