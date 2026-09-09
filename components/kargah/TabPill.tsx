"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { activeSalesGroup, type SalesTab } from "@/lib/salesNav";

export type Tab = SalesTab;

/** Slides the `.thumb` inside `root` to sit under whichever child matches `current`. */
function slideThumb(root: HTMLElement | null, current: string) {
  if (!root) return;
  const on = root.querySelector<HTMLElement>(current);
  const thumb = root.querySelector<HTMLElement>(".thumb");
  if (!on || !thumb) return;
  thumb.style.width = `${on.offsetWidth}px`;
  thumb.style.transform = `translateX(${on.offsetLeft}px)`;
}

/** The tabs of whichever group is active, with a pill that travels between them.
 *
 *  Used to render its own group row above this one -- that row moved into Navbar
 *  (components/kargah/Navbar.tsx) as hover/click dropdowns, spec 2026-09-08 §9a. This
 *  component now owns only the second row: the active group's own destinations.
 */
export default function TabPill({ tabs }: { tabs: SalesTab[] }) {
  const seg = useRef<HTMLElement | null>(null);
  const pathname = usePathname();

  const activeGroup = activeSalesGroup(pathname, tabs);

  const visibleTabs = useMemo(
    () => tabs.filter((t) => t.group === activeGroup),
    [tabs, activeGroup],
  );

  /* Longest match, not equality: /sales/orders/new must light سفارش‌ها, and /sales is a
     prefix of everything so it only wins when nothing longer does. */
  const active = visibleTabs
    .filter((t) => t.ready && (pathname === t.href || pathname.startsWith(`${t.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  const move = useCallback(() => {
    slideThumb(seg.current, '[aria-current="page"]');
  }, []);

  useEffect(() => {
    /* Place the thumb BEFORE its transition is enabled -- see .seg.ready in globals.css. */
    move();
    const id = requestAnimationFrame(() => {
      move();
      seg.current?.classList.add("ready");
    });

    const ro = new ResizeObserver(move);
    if (seg.current) ro.observe(seg.current);
    /* Persian glyph widths change when the webfont lands, moving every item under a thumb
       that was already measured. */
    document.fonts?.ready.then(move).catch(() => {});

    return () => {
      cancelAnimationFrame(id);
      ro.disconnect();
    };
  }, [move, active, pathname, activeGroup]);

  return (
    <div className="segwrap">
      <nav className="seg" ref={seg as React.RefObject<HTMLElement>} aria-label="بخش‌های فروش">
        <span className="thumb" aria-hidden="true" />
        {visibleTabs.map((t) =>
          t.ready ? (
            <Link key={t.href} href={t.href} aria-current={t.href === active ? "page" : undefined}>
              {t.label}
            </Link>
          ) : (
            <span key={t.href} aria-disabled="true">
              {t.label} <span className="text-[length:var(--text-xs)]">· به‌زودی</span>
            </span>
          ),
        )}
      </nav>
    </div>
  );
}
