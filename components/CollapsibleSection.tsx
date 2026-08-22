"use client";

import { useState } from "react";

// Progressive disclosure for a sidebar list that can legitimately run to dozens of
// rows (dormant customers, customers with no coordinates) -- collapsed by default so
// the panel doesn't dump every row into view the moment there happen to be many,
// while the count in the header still tells you at a glance whether it's worth opening.
export default function CollapsibleSection({
  title,
  count,
  titleClassName,
  defaultOpen = false,
  children,
}: {
  title: string;
  count: number;
  titleClassName?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`mb-2 flex w-full items-center justify-between gap-2 font-mono text-[length:var(--text-xs)] uppercase tracking-wide transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-accent ${
          titleClassName ?? "text-text-muted"
        }`}
      >
        <span>
          {title} ({count})
        </span>
        <span
          className="text-text-faint transition-transform duration-[var(--dur-base)] ease-[var(--ease-out)]"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        >
          ▾
        </span>
      </button>
      {open && children}
    </section>
  );
}
