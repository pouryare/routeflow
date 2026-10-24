/** Placeholders shaped like the content that is loading.
 *
 *  The app used to say «در حال بارگذاری…» in a single line of small text wherever a
 *  fetch was in flight, and then drop a grid or a list into that one line's worth of
 *  space -- so every panel visibly jumped once its data arrived. These reserve the real
 *  height up front, which is the entire point; the shimmer is only there so the reader
 *  can tell a placeholder from an empty state.
 *
 *  The blocks are HeroUI's Skeleton, drawn as spans so a line can sit inside running
 *  text. A client module because HeroUI's is, and because the span is drawn by a render
 *  function, which cannot cross from a server component; every prop here is a string, so
 *  server pages render these as before.
 */
"use client";

import type { ComponentPropsWithRef } from "react";
import { Skeleton } from "@heroui/react";

const asSpan = (props: ComponentPropsWithRef<"span">) => <span {...props} />;

/** One line of text. `w` is a Tailwind width class so a list of these can be given
 *  uneven lengths -- equal-length bars read as a table, not as prose. */
export function SkeletonLine({ w = "w-full", className = "" }: { w?: string; className?: string }) {
  return <Skeleton render={asSpan} animationType="shimmer" className={`block h-3 ${w} ${className}`} />;
}

/** A rectangle: a thumbnail, a map, a chart. */
export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <Skeleton render={asSpan} animationType="shimmer" className={`block ${className}`} />;
}

/** The repeated-row case -- the shape of every list in this app: one bordered card with
 *  a label and a short figure per line. ONE card, not a card per row: a stack of little
 *  bordered boxes is the "multiple tiny cards" of item 20. */
export function SkeletonRows({ rows = 3, className = "" }: { rows?: number; className?: string }) {
  // Varied widths, cycled rather than random: a random width would change on every
  // render and make the placeholder itself flicker.
  const widths = ["w-2/3", "w-1/2", "w-3/4", "w-5/12"];
  return (
    <div
      className={`flex flex-col gap-3.5 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-3.5 ${className}`}
      aria-hidden="true"
    >
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-2">
          <SkeletonLine w={widths[i % widths.length]} />
          <SkeletonLine w="w-10" className="shrink-0" />
        </div>
      ))}
    </div>
  );
}

/** A grid of square thumbnails, for the two photo galleries. */
export function SkeletonThumbs({ count = 6, className = "" }: { count?: number; className?: string }) {
  return (
    <div className={`grid grid-cols-3 gap-2 ${className}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonBlock key={i} className="aspect-square rounded-[var(--radius-md)]" />
      ))}
    </div>
  );
}

/** The screen-reader half of every skeleton above, which are all aria-hidden: they
 *  describe a shape, and a shape read aloud is noise. Pair one of these with them so a
 *  non-visual reader is told that something is on its way. */
export function SkeletonLabel({ children = "در حال بارگذاری…" }: { children?: string }) {
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {children}
    </span>
  );
}
