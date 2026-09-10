"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { activeGroup, type AppGroupId, type AppTab } from "@/lib/appNav";
import { popover, withReducedMotion } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";

export type PillGroup = { id: AppGroupId; label: string; href: string; active: boolean };
export type PillModel = {
  groups: PillGroup[];
  tabsByGroup: Record<string, AppTab[]>;
  /** The href of the tab the current path is on, for aria-current inside the popover. */
  currentHref: string | undefined;
};

/** Everything the pill needs to decide, as a pure function.
 *
 *  A group appears only if the role can reach something inside it, and its chip links to
 *  the first thing it can reach — so a chip is never a dead end. Longest-prefix match
 *  throughout: /sales/orders/12 belongs to سفارش‌ها, and /sales is a prefix of everything
 *  so it only wins when nothing longer does.
 */
export function pillModel(
  tabs: AppTab[],
  groups: { id: AppGroupId; label: string }[],
  pathname: string,
): PillModel {
  const tabsByGroup: Record<string, AppTab[]> = {};
  for (const g of groups) {
    const ready = tabs.filter((t) => t.group === g.id && t.ready);
    if (ready.length) tabsByGroup[g.id] = ready;
  }

  const current = activeGroup(pathname, tabs);
  const hit = tabs
    .filter((t) => t.ready && (pathname === t.href || pathname.startsWith(`${t.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0];

  const shown = groups
    .filter((g) => tabsByGroup[g.id])
    .map((g) => ({
      id: g.id,
      label: g.label,
      href: tabsByGroup[g.id][0].href,
      /* Only light a chip when the path actually resolved to a tab. activeGroup falls
         back to the first ready group for an unknown path, which is the right default for
         "which tabs do I show" but would be a lie on the chip. */
      active: Boolean(hit) && g.id === current,
    }));

  return { groups: shown, tabsByGroup, currentHref: hit?.href };
}

export type PopAnchor = { left: number; top: number };

/** Where the hover panel sits, as a style object.
 *
 *  `left` — physical — because the number comes from getBoundingClientRect, which is
 *  physical. This used to be `insetInlineStart`, which in RTL resolves to `right`: the
 *  panel was placed its measured distance from the OPPOSITE edge, so hovering the first
 *  chip opened a menu under the last one. Logical properties are for values expressed in
 *  logical terms; a measured viewport offset is not one.
 *
 *  Pure, so tests/hoverPill.test.ts can hold the rule without rendering anything.
 */
export function popoverStyle(anchor: PopAnchor | null): React.CSSProperties | undefined {
  if (!anchor) return undefined;
  return { position: "fixed", top: anchor.top, left: anchor.left };
}

/** Slides the `.thumb` inside `root` to sit under whichever child matches `current`.
 *  offsetLeft/offsetWidth are read from the row's own box, so it stays correct wherever
 *  the row sits and in either writing direction. Call it once BEFORE the row gets
 *  `.ready`, so the first placement is not animated up from width:0 -- see
 *  `.meridian .seg.ready .thumb`. Ported unchanged from TabPill. */
function slideThumb(root: HTMLElement | null, current: string) {
  if (!root) return;
  /* Measure the .seg-item wrapper, not the <a> inside it: offsetLeft is relative to the
     nearest positioned ancestor, and .seg-item is positioned so the popover can anchor
     to it. Measuring the link would give a number relative to its own wrapper — always
     ~0 — and pin the thumb to the start of the row. */
  const on = root.querySelector<HTMLElement>(current)?.closest<HTMLElement>(".seg-item")
    ?? root.querySelector<HTMLElement>(current);
  const thumb = root.querySelector<HTMLElement>(".thumb");
  if (!on || !thumb) return;
  thumb.style.width = `${on.offsetWidth}px`;
  thumb.style.transform = `translateX(${on.offsetLeft}px)`;
}

/** How long the popover survives the pointer leaving, so a diagonal move from the chip
 *  down into the panel does not dismiss it mid-travel. */
const CLOSE_DELAY_MS = 180;

/** One row of group chips beside the brand, with the group's tabs on hover.
 *
 *  This replaces TabPill's two permanent rows. The travelling thumb and its measuring
 *  are kept verbatim — that movement is the signature, and it is what tells you which
 *  way you went. What changes is that the second row becomes a popover, so twenty-odd
 *  destinations cost one row of chrome instead of two.
 *
 *  Reachability without hover is deliberate and lives elsewhere: the page-overview card
 *  carries the active group's siblings inline, so a touch or keyboard reader never needs
 *  this popover to move between neighbours.
 */
export default function HoverPill({
  tabs,
  groups,
}: {
  tabs: AppTab[];
  groups: { id: AppGroupId; label: string }[];
}) {
  const pathname = usePathname();
  const grp = useRef<HTMLElement | null>(null);
  /* Stored WITH the path it was opened on, so a route change closes it by derivation
     rather than by an effect that calls setState — the popover that got you here should
     not still be hanging over the page you landed on. */
  const [opened, setOpened] = useState<{ id: AppGroupId; path: string } | null>(null);
  const open = opened?.path === pathname ? opened.id : null;
  const setOpen = useCallback(
    (id: AppGroupId | null) => setOpened(id ? { id, path: pathname } : null),
    [pathname],
  );
  /* The group row is a horizontal scroll container, so an absolutely-positioned popover
     inside it would be clipped at the row's edge. Measure the chip and place the panel
     with position:fixed instead — it then escapes every ancestor's overflow. */
  const [anchor, setAnchor] = useState<PopAnchor | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduced = usePrefersReducedMotion();

  const model = useMemo(() => pillModel(tabs, groups, pathname), [tabs, groups, pathname]);

  const move = useCallback(() => slideThumb(grp.current, '[aria-current="true"]'), []);

  useEffect(() => {
    /* Place the thumb BEFORE its transition is enabled -- see .seg.ready in globals.css. */
    move();
    const id = requestAnimationFrame(() => {
      move();
      grp.current?.classList.add("ready");
    });
    const ro = new ResizeObserver(move);
    if (grp.current) ro.observe(grp.current);
    /* Persian glyph widths change when the webfont lands, moving every item under a thumb
       that was already measured. */
    document.fonts?.ready.then(move).catch(() => {});
    return () => {
      cancelAnimationFrame(id);
      ro.disconnect();
    };
  }, [move, pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      /* setOpened, not setOpen: Esc closes outright, and closing needs no path — going
         through setOpen would pull `pathname` into this effect's deps and re-bind the
         listener on every navigation for no reason. */
      if (e.key === "Escape") setOpened(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const openAt = (id: AppGroupId, el: HTMLElement | null) => {
    const chip = el?.closest<HTMLElement>(".seg-item");
    if (chip) {
      const r = chip.getBoundingClientRect();
      setAnchor({ left: r.left, top: r.bottom + 8 });
    }
    setOpen(id);
  };

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(null), CLOSE_DELAY_MS);
  };
  /* Hover only where hovering is real. On a touch screen pointerenter fires on the tap
     that was meant to activate the link, which would open a menu the reader then has to
     dismiss before they can go anywhere. */
  const canHover = () =>
    typeof matchMedia === "function" ? matchMedia("(hover: hover)").matches : false;

  return (
    <div className="segwrap" onMouseLeave={scheduleClose}>
      <nav className="seg seg-groups" ref={grp as React.RefObject<HTMLElement>} aria-label="بخش‌های برنامه">
        <span className="thumb" aria-hidden="true" />
        {model.groups.map((g) => {
          const isOpen = open === g.id;
          return (
            <span
              key={g.id}
              className="seg-item"
              onPointerEnter={(e) => {
                if (!canHover()) return;
                cancelClose();
                openAt(g.id, e.currentTarget as HTMLElement);
              }}
              onPointerLeave={() => {
                if (canHover()) scheduleClose();
              }}
            >
              <Link
                href={g.href}
                aria-current={g.active ? "true" : undefined}
                aria-haspopup="true"
                aria-expanded={isOpen}
                onClick={(e) => {
                  /* Touch: the first tap opens the group rather than jumping to its first
                     tab, so the reader gets to choose. The second tap on a tab navigates. */
                  if (!canHover() && !isOpen) {
                    e.preventDefault();
                    openAt(g.id, e.currentTarget as HTMLElement);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    openAt(g.id, e.currentTarget as HTMLElement);
                  }
                }}
              >
                {g.label}
              </Link>

              <AnimatePresence>
                {isOpen && (
                  <motion.span
                    className="seg-pop"
                    role="menu"
                    aria-label={g.label}
                    style={popoverStyle(anchor)}
                    initial={popover.initial}
                    animate={withReducedMotion(popover.animate, reduced)}
                    exit={withReducedMotion(popover.exit, reduced)}
                    onPointerEnter={cancelClose}
                    onPointerLeave={scheduleClose}
                  >
                    {model.tabsByGroup[g.id].map((t) => (
                      <Link
                        key={t.href}
                        href={t.href}
                        role="menuitem"
                        aria-current={t.href === model.currentHref ? "page" : undefined}
                        onClick={() => setOpen(null)}
                      >
                        {t.label}
                      </Link>
                    ))}
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
          );
        })}
      </nav>
    </div>
  );
}
