"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  activeSalesGroup,
  type SalesGroupId,
  type SalesTab,
} from "@/lib/salesNav";

export type Tab = SalesTab;

/** Slides the `.thumb` inside `root` to sit under whichever child matches `current`.
 *  One measure-then-move for BOTH nav rows; offsetLeft/offsetWidth are read from the
 *  row's own box, so it stays correct wherever the (centred) row sits and in either
 *  writing direction. Call it once BEFORE the row gets `.ready`, so the first placement
 *  is not animated up from width:0 -- see `.kargah .seg.ready .thumb`. */
function slideThumb(root: HTMLElement | null, current: string) {
  if (!root) return;
  const on = root.querySelector<HTMLElement>(current);
  const thumb = root.querySelector<HTMLElement>(".thumb");
  if (!on || !thumb) return;
  thumb.style.width = `${on.offsetWidth}px`;
  thumb.style.transform = `translateX(${on.offsetLeft}px)`;
}

/** Two rows: the six groups, then the tabs of whichever group is active -- and BOTH rows
 *  carry a pill that travels between their items on the same spring. The movement is
 *  what tells you which way you went; the group row keeps twenty-odd destinations from
 *  being one long scroll.
 */
export default function TabPill({
  tabs,
  groups,
}: {
  tabs: SalesTab[];
  groups: { id: SalesGroupId; label: string }[];
}) {
  const seg = useRef<HTMLElement | null>(null);
  const grp = useRef<HTMLElement | null>(null);
  const pathname = usePathname();

  const activeGroup = activeSalesGroup(pathname, tabs);

  const shownGroups = useMemo(
    () =>
      groups
        .map((g) => ({ ...g, first: tabs.find((t) => t.group === g.id && t.ready)?.href }))
        .filter((g): g is typeof g & { first: string } => Boolean(g.first)),
    [groups, tabs],
  );

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
    slideThumb(grp.current, '[aria-current="true"]');
    slideThumb(seg.current, '[aria-current="page"]');
  }, []);

  useEffect(() => {
    /* Place both thumbs BEFORE their transition is enabled -- see .seg.ready in globals.css. */
    move();
    const id = requestAnimationFrame(() => {
      move();
      seg.current?.classList.add("ready");
      grp.current?.classList.add("ready");
    });

    const ro = new ResizeObserver(move);
    if (seg.current) ro.observe(seg.current);
    if (grp.current) ro.observe(grp.current);
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
      <nav
        className="seg seg-groups"
        ref={grp as React.RefObject<HTMLElement>}
        aria-label="گروه‌های فروش"
      >
        <span className="thumb" aria-hidden="true" />
        {shownGroups.map((g) => (
          <Link
            key={g.id}
            href={g.first}
            aria-current={g.id === activeGroup ? "true" : undefined}
          >
            {g.label}
          </Link>
        ))}
      </nav>

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
