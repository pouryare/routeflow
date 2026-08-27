"use client";

import { useEffect, useRef } from "react";
import { staggerDelays } from "@/lib/design/stagger";

type RevealProps = {
  children: React.ReactNode;
  /** Change this to replay the entrance -- e.g. the active route. */
  replayKey?: string | number;
  step?: number;
  className?: string;
  /** A selector for the elements to stagger, when they are not the direct children.
   *  A list is the case that needs it: the wrapper cannot BE the <ul>, because the
   *  children of a list have to be <li>, so the items sit one level down. */
  select?: string;
};

/** Staggers its direct element children in. See MASTER.md, Motion, Tier 0.
 *
 *  Wraps rather than clones so it works over server-rendered children it knows nothing
 *  about: the sales pages are RSC, and their cards never reach the client as React
 *  elements this component could add a prop to.
 */
export default function Reveal({
  children,
  replayKey,
  step = 55,
  className,
  select,
}: RevealProps) {
  const host = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = host.current;
    if (!root) return;
    const items = Array.from(
      select ? root.querySelectorAll(select) : root.children
    ).filter((el): el is HTMLElement => el instanceof HTMLElement);
    if (!items.length) return;

    const reduced =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    const delays = staggerDelays(items.length, step, 10, reduced);

    /* The reset must not itself be delayed.
     *
     * A zero-duration transition that carries a DELAY still holds the old value for the
     * length of that delay. So if the stagger is left on the element here, the reset is
     * postponed past the moment the entrance is switched back on, the element never
     * actually leaves its finished state, and only the first item -- the one with delay
     * 0 -- ever animates. It fails silently: no error, just a stagger of one.
     *
     * Hence: kill the transition, clear the delay, force the start state to be computed,
     * and only then restore the transition and re-apply the delay. */
    for (const el of items) {
      el.classList.add("rev");
      el.classList.remove("rev-in");
      el.style.transition = "none";
      el.style.transitionDelay = "";
    }
    void document.body.offsetHeight;

    items.forEach((el, i) => {
      el.style.transition = "";
      el.style.transitionDelay = `${delays[i]}ms`;
      el.classList.add("rev-in");
    });
  }, [replayKey, step, select]);

  return (
    <div ref={host} className={className}>
      {children}
    </div>
  );
}
