"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "@/components/meridian/Icon";
import { popover, withReducedMotion } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import { getHelp, isTodo } from "@/lib/help";

/** The `(i)` button that belongs in a card header. Click (a deliberate act, not hover)
 *  opens a small panel: what the figure shows, and how to read it. An id with no copy
 *  yet renders a calm placeholder rather than nothing.
 *
 *  Dismissal matches ProfileMenu / AccentPicker — click-outside and Esc. The enter/exit
 *  is framer-motion (the first consumer of lib/motion.ts), collapsing to an instant
 *  paint under reduced motion. */
export function CardHelp({ id, className }: { id: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const reduced = usePrefersReducedMotion();
  const entry = getHelp(id);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={root} className={`mhelp${className ? ` ${className}` : ""}`}>
      <button
        type="button"
        className="mhelp__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="راهنمای این بخش"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="info" size="sm" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.span
            role="dialog"
            aria-label="راهنما"
            className="mhelp__panel"
            dir="rtl"
            initial={popover.initial}
            animate={withReducedMotion(popover.animate, reduced)}
            exit={withReducedMotion(popover.exit, reduced)}
          >
            {isTodo(entry) ? (
              <p className="mhelp__todo">راهنمای این بخش به‌زودی</p>
            ) : (
              <>
                <p className="mhelp__title">{entry.title}</p>
                <p className="mhelp__what">{entry.what}</p>
                <p className="mhelp__how">
                  <span className="mhelp__how-label">چطور بخوانیم:</span> {entry.how}
                </p>
              </>
            )}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

export default CardHelp;
