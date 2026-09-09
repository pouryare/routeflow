"use client";

import { useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

/** A generic sliding-pill segmented control -- the trough-with-a-travelling-pill pattern
 *  the video's tab bars use, reusing TabPill's measure-then-translateX technique without
 *  TabPill's navigation-specific coupling to SalesTab/SalesGroupId.
 *
 *  Placed BEFORE its transition is enabled (the .ready class, added one animation frame
 *  later) -- same discipline as TabPill, and for the same reason: without it, the first
 *  paint animates the thumb sliding in from width:0 instead of appearing already in
 *  place. */
export default function SegmentedPill<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  const root = useRef<HTMLDivElement | null>(null);

  const slide = useCallback(() => {
    const el = root.current;
    if (!el) return;
    const on = el.querySelector<HTMLElement>(`[data-value="${value}"]`);
    const thumb = el.querySelector<HTMLElement>(".seg-thumb");
    if (!on || !thumb) return;
    thumb.style.width = `${on.offsetWidth}px`;
    thumb.style.transform = `translateX(${on.offsetLeft}px)`;
  }, [value]);

  useEffect(() => {
    slide();
    const id = requestAnimationFrame(() => {
      slide();
      root.current?.classList.add("ready");
    });

    const ro = new ResizeObserver(slide);
    if (root.current) ro.observe(root.current);
    // Persian glyph widths change when the webfont lands, moving every item under a
    // thumb that was already measured.
    document.fonts?.ready.then(slide).catch(() => {});

    return () => {
      cancelAnimationFrame(id);
      ro.disconnect();
    };
  }, [slide]);

  return (
    <div
      ref={root}
      role="group"
      className={cn(
        "seg-pill relative inline-flex rounded-[var(--radius-pill)] bg-[var(--surface-sunk)] p-1",
        className,
      )}
    >
      <span className="seg-thumb absolute inset-y-1 rounded-[var(--radius-pill)] bg-[var(--primary)]" />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          data-value={o.value}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "relative z-[1] rounded-[var(--radius-pill)] px-4 py-1.5 text-[length:var(--text-sm)] transition-colors",
            o.value === value ? "text-[var(--primary-ink)]" : "text-[var(--text-muted)]",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
