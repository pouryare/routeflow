"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";

/** The gooey SVG-filter search input -- confirmed via Aceternity's documented mechanism
 *  to be feGaussianBlur + feColorMatrix contrast, reimplemented here in plain SVG rather
 *  than pulled in as a dependency. */
export default function GooeyInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const filterId = useId();
  return (
    <div className={cn("relative", className)} style={{ filter: `url(#${filterId})` }}>
      <svg width="0" height="0" className="absolute">
        <filter id={filterId}>
          <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
          <feColorMatrix
            in="blur"
            mode="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -11"
          />
        </filter>
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--surface)] px-5 py-3 text-[var(--text)] outline-none focus:border-[var(--accent)]"
      />
    </div>
  );
}
