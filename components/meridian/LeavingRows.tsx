"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { DUR, EASE, withReducedMotion } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";

/** A list whose rows leave smoothly: a row that drops out of the data (moved on, confirmed,
 *  dismissed) fades and slides away, and the rows under it glide up into the gap instead of
 *  jumping, so the reader never loses their place. Children must be LeavingRow, keyed by
 *  something stable (an id, never the index: an index key would animate the wrong row out).
 *
 *  popLayout takes the leaving row out of the flow at once, so its neighbours start closing
 *  the gap while it fades; the parent must be positioned for that (`.col` is). */
export function LeavingRows({ children }: { children: ReactNode }) {
  return (
    <AnimatePresence initial={false} mode="popLayout">
      {children}
    </AnimatePresence>
  );
}

const TAGS = { div: motion.div, article: motion.article, li: motion.li } as const;

/** One row of a LeavingRows list. New rows simply appear (no entrance), so a list that
 *  loads does not ripple; only leaving and the gap closing are animated. */
export function LeavingRow({ as = "div", className, children }: {
  as?: keyof typeof TAGS;
  className?: string;
  children: ReactNode;
}) {
  const reduced = usePrefersReducedMotion();
  const Tag = TAGS[as];
  return (
    <Tag
      className={className}
      layout={reduced ? false : "position"}
      transition={withReducedMotion({ duration: DUR.settle, ease: EASE.out }, reduced)}
      exit={{ opacity: 0, x: -24, transition: withReducedMotion({ duration: 0.2, ease: EASE.out }, reduced) }}
    >
      {children}
    </Tag>
  );
}
