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
  "/sales/stock": [".card", ".kblock"],
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
 */
export default function RevealRoute() {
  const pathname = usePathname();

  useEffect(() => {
    const selectors = selectorsFor(pathname);
    if (!selectors.length) return;

    const items: HTMLElement[] = [];
    for (const sel of selectors) {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
        // A card already claimed by an earlier selector must not be staggered twice.
        if (!items.includes(el)) items.push(el);
      }
    }
    if (!items.length) return;

    const reduced =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* The reset must not itself be delayed.
     *
     * A zero-duration transition that carries a DELAY still holds the old value for the
     * length of that delay. Leaving the stagger on here postpones the reset past the
     * moment the entrance is switched back on, so the element never leaves its finished
     * state and only the first card — the one with delay 0 — ever animates. It fails
     * silently: no error, just a stagger of one. */
    const lift = items.length <= LIFT_MAX;
    for (const el of items) {
      el.classList.add("rev");
      el.classList.toggle("rev-lift", lift);
      el.classList.remove("rev-in");
      el.style.transition = "none";
      el.style.transitionDelay = "";
    }
    void document.body.offsetHeight;

    items.forEach((el, i) => {
      el.style.transition = "";
      el.style.transitionDelay = reduced ? "0ms" : `${Math.min(i, CAP) * STAGGER}ms`;
      el.classList.add("rev-in");
    });
  }, [pathname]);

  return null;
}
