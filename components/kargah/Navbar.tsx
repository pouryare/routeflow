"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  SALES_GROUPS,
  activeSalesGroup,
  type SalesGroupId,
  type SalesTab,
} from "@/lib/salesNav";
import GlassFace from "@/components/kargah/GlassFace";
import { cn } from "@/lib/cn";

/** The single-row navbar, spec 2026-09-08 §9a: brand at inline-start (visual right under
 *  RTL), the six sales groups centred, utility cluster (profile) at inline-end (visual
 *  left) -- logical properties throughout, never left:/right:, so the same markup would
 *  mirror correctly under a future LTR locale.
 *
 *  Each group pill is a real <button> that CLICK-TOGGLES its dropdown (same open/
 *  outside-click/Esc pattern as ProfileMenu) -- HOVER-opens it too, but only under
 *  (hover: hover) and (pointer: fine), a pure-CSS enhancement layered on top so a mouse
 *  user gets the video's hover behaviour while touch and keyboard still get a working
 *  control. This absorbed TabPill's former group row (components/kargah/TabPill.tsx),
 *  which now renders only the tab row beneath this.
 */
export default function Navbar({
  tabs,
  brand,
  profile,
}: {
  tabs: SalesTab[];
  brand: React.ReactNode;
  profile: React.ReactNode;
}) {
  const pathname = usePathname();
  const activeGroup = activeSalesGroup(pathname, tabs);
  const [openGroup, setOpenGroup] = useState<SalesGroupId | null>(null);
  const root = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!openGroup) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpenGroup(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenGroup(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openGroup]);

  return (
    <nav ref={root as React.RefObject<HTMLElement>} className="navbar" aria-label="ناوبری اصلی" dir="rtl">
      <div className="navbar__brand">{brand}</div>

      <ul className="navbar__groups">
        {SALES_GROUPS.map((g) => {
          const groupTabs = tabs.filter((t) => t.group === g.id);
          const firstReady = groupTabs.find((t) => t.ready)?.href;
          if (!firstReady) return null;
          const isActive = g.id === activeGroup;
          const isOpen = openGroup === g.id;
          return (
            <li key={g.id} className="navbar__navgroup">
              <button
                type="button"
                className={cn("navbar__pill", isActive && "navbar__pill--active")}
                aria-expanded={isOpen}
                aria-haspopup="true"
                onClick={() => setOpenGroup((v) => (v === g.id ? null : g.id))}
              >
                {g.label}
              </button>
              {/* Always in the DOM, hidden by CSS default -- NOT gated on isOpen. A mouse
                  user's hover never touches React state at all (pure :hover/:focus-within
                  CSS, gated to fine pointers); click drives `isOpen` via data-open for
                  keyboard and touch. Conditionally RENDERING this on isOpen (the first
                  version of this component did) breaks the hover case entirely -- CSS
                  can only reveal a node that already exists. */}
              <GlassFace className="navbar__dropdown" data-open={isOpen || undefined}>
                {groupTabs.map((t) =>
                  t.ready ? (
                    <Link
                      key={t.href}
                      href={t.href}
                      className="navbar__dropitem"
                      data-active={pathname === t.href || pathname.startsWith(`${t.href}/`) ? "true" : undefined}
                      onClick={() => setOpenGroup(null)}
                    >
                      {t.label}
                    </Link>
                  ) : (
                    <span key={t.href} className="navbar__dropitem navbar__dropitem--disabled">
                      {t.label} · به‌زودی
                    </span>
                  ),
                )}
              </GlassFace>
            </li>
          );
        })}
      </ul>

      <div className="navbar__utility">{profile}</div>
    </nav>
  );
}
