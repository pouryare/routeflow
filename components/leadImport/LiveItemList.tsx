"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Icon } from "@/components/meridian/Icon";
import { faNum } from "@/lib/format";
import { RESOLUTION_META } from "@/lib/leadImportMeta";
import type { LocationResolution } from "@/lib/db";
import { EASE, DUR, withReducedMotion } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";

export interface LiveItem {
  id: number;
  ordinal: number;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  resolution: string;
  status: "pending" | "resolving" | "done" | "unresolved" | "duplicate" | "skipped";
  duplicate_name: string | null;
}

/** How many rows are actually drawn. A thousand pasted links must not become a thousand
 *  DOM nodes fighting the map for frame budget; the rest are counted, not rendered. */
const RENDER_LIMIT = 40;

/** The one place that says what is happening, in words, on every row.
 *
 *  The shimmer's *speed* is the countdown: a link two seconds into a twelve-second
 *  browser attempt sweeps briskly, one at eleven seconds barely moves at all. So the
 *  animation is not filling a silence, it is telling the user how close that link is to
 *  giving up -- which is the one thing a plain spinner cannot say. */
const STAGE_LABEL: Record<string, string> = {
  pending: "در صف",
  resolving: "در حال خواندن لینک",
};

function rowMeta(item: LiveItem) {
  if (item.status === "pending") return { text: STAGE_LABEL.pending, tone: "faint" as const };
  if (item.status === "resolving") return { text: STAGE_LABEL.resolving, tone: "muted" as const };
  if (item.status === "done") {
    // The wire type is a plain string, so narrow it before indexing rather than
    // casting: RESOLUTION_META is keyed by the real union and a miss would otherwise
    // render an empty badge rather than fail here.
    const meta = RESOLUTION_META[item.resolution as LocationResolution];
    return { text: meta?.label ?? "دقیق", tone: "good" as const };
  }
  if (item.status === "duplicate") {
    return {
      text: item.duplicate_name ? `تکراری: ${item.duplicate_name}` : "تکراری",
      tone: "warn" as const,
    };
  }
  return { text: "نیاز به مکان‌یابی دستی", tone: "warn" as const };
}

const TONE_CLASS: Record<string, string> = {
  faint: "text-text-faint",
  muted: "text-text-muted",
  good: "text-[color:var(--good)]",
  warn: "text-[color:var(--warn)]",
};

export default function LiveItemList({ items }: { items: LiveItem[] }) {
  const reduced = usePrefersReducedMotion();
  const shown = items.slice(0, RENDER_LIMIT);
  const hidden = items.length - shown.length;

  return (
    <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto" aria-live="polite">
      {shown.map((item) => (
        <LiveRow key={item.id} item={item} reduced={reduced} />
      ))}
      {hidden > 0 && (
        <li className="px-1 py-1 text-[length:var(--text-xs)] text-text-faint">
          و {faNum(hidden)} مورد دیگر — در نقشه نمایش داده می‌شود
        </li>
      )}
    </ul>
  );
}

function LiveRow({ item, reduced }: { item: LiveItem; reduced: boolean }) {
  const meta = rowMeta(item);
  const settled = item.status !== "pending" && item.status !== "resolving";
  const [age, setAge] = useState(0);
  const started = useRef<number | null>(null);

  // Age is what drives the shimmer's slowdown, so it has to tick locally rather than
  // arrive with the one-second poll -- a link that has been grinding for eleven seconds
  // should be visibly different from one at two, and the poll cannot see that.
  useEffect(() => {
    if (item.status !== "resolving") {
      started.current = null;
      return;
    }
    if (started.current === null) started.current = Date.now();
    const id = setInterval(() => setAge(Date.now() - started.current!), 250);
    return () => clearInterval(id);
  }, [item.status]);

  // Slower as it ages, and it gives up visually at the 12s the browser timeout allows.
  const shimmerSeconds = Math.min(2.4, 0.9 + age / 6000);

  return (
    <motion.li
      layout={!reduced}
      transition={withReducedMotion({ duration: DUR.settle, ease: EASE.out }, reduced)}
      className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2"
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--accent)]"
        style={{ opacity: settled ? 0 : 0.9 }}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[length:var(--text-sm)] text-text">
          {item.name || "مکان بدون نام"}
        </p>
        {item.address && (
          <p className="truncate text-[length:var(--text-xs)] text-text-faint">{item.address}</p>
        )}
      </div>
      <span
        className={`flex shrink-0 items-center gap-1 text-[length:var(--text-xs)] ${TONE_CLASS[meta.tone]}`}
      >
        {item.status === "resolving" && !reduced && (
          <span
            aria-hidden="true"
            className="inline-block h-1 w-6 overflow-hidden rounded-full bg-[color:var(--border-strong)]"
          >
            <span
              className="leadimport-shimmer block h-full w-1/2 rounded-full bg-[color:var(--accent)]"
              style={{
                animation: `leadimport-shimmer ${shimmerSeconds}s linear infinite`,
              }}
            />
          </span>
        )}
        {settled && <Icon name={item.status === "done" ? "check" : "warn"} size="sm" />}
        {meta.text}
      </span>
    </motion.li>
  );
}
