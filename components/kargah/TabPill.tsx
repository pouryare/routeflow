"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

export type Tab = {
  href: string;
  label: string;
  /** A tab whose page does not exist yet renders as a span. Next prefetches every
   *  <Link> on render, so a link to a missing route 404s in the console before anyone
   *  touches it -- and then under the first person who does. */
  ready: boolean;
};

/** One pill that travels between tabs, instead of a background switching off one and
 *  on another. The movement is what tells you which way you just went.
 */
export default function TabPill({ tabs }: { tabs: Tab[] }) {
  const seg = useRef<HTMLElement | null>(null);
  const pathname = usePathname();

  /* Longest match, not equality: /sales/orders/new must light the سفارش‌ها tab, and a
     plain === would light nothing at all on every detail route. /sales itself is the
     prefix of every other tab, so it only ever wins when nothing longer does. */
  const active = tabs
    .filter((t) => t.ready && (pathname === t.href || pathname.startsWith(`${t.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  const move = useCallback(() => {
    const root = seg.current;
    if (!root) return;
    const on = root.querySelector<HTMLElement>('[aria-current="page"]');
    const thumb = root.querySelector<HTMLElement>(".thumb");
    if (!on || !thumb) return;
    thumb.style.width = `${on.offsetWidth}px`;
    thumb.style.transform = `translateX(${on.offsetLeft}px)`;
  }, []);

  useEffect(() => {
    /* Place it BEFORE the transition is enabled -- see .seg-ready in globals.css. */
    move();
    const id = requestAnimationFrame(() => {
      move();
      seg.current?.classList.add("ready");
    });

    const ro = new ResizeObserver(move);
    if (seg.current) ro.observe(seg.current);
    /* Persian glyph widths change when the webfont lands, which moves every tab under
       a thumb that has already been measured. */
    document.fonts?.ready.then(move).catch(() => {});

    return () => {
      cancelAnimationFrame(id);
      ro.disconnect();
    };
  }, [move, active, pathname]);

  return (
    <nav className="seg" ref={seg as React.RefObject<HTMLElement>} aria-label="بخش‌های فروش">
      <span className="thumb" aria-hidden="true" />
      {tabs.map((t) =>
        t.ready ? (
          <Link key={t.href} href={t.href} aria-current={t.href === active ? "page" : undefined}>
            {t.label}
          </Link>
        ) : (
          <span key={t.href} aria-disabled="true">
            {t.label} <span className="text-[length:var(--text-xs)]">· به‌زودی</span>
          </span>
        )
      )}
    </nav>
  );
}
