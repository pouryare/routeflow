"use client";

import { useEffect, useRef } from "react";
import { Icon } from "@/components/meridian/Icon";

/** The header's search affordance.
 *
 *  Inert on purpose in this slice: it reserves the space so the header's proportions are
 *  final, and it owns the ⌘K / Ctrl-K binding so the command palette can drop in later
 *  without AppHeader changing at all. Pressing the shortcut focuses the control; that is
 *  the whole behaviour for now, and it is honest — a placeholder that silently does
 *  nothing on click would be worse than one that visibly takes focus.
 */
export default function SearchSlot() {
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        btn.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <button ref={btn} type="button" className="searchslot" aria-label="جستجو">
      <Icon name="search" size="sm" />
      <span className="searchslot__label">جستجو…</span>
      <kbd className="searchslot__kbd" aria-hidden="true">
        ⌘K
      </kbd>
    </button>
  );
}
