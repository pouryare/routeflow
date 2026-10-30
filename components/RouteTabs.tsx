"use client";

import { useEffect, useRef } from "react";
import { Tabs } from "@heroui/react";
import { boxOf, slidePill, type Box } from "@/lib/pillSlide";

/** A key no tab has. React Aria picks the first tab whenever `selectedKey` is null. */
const NONE = "__none";

export type RouteTab = { href: string; label: string };

/** Where each row's pill was last drawn, by the row's label. Every page draws its own row,
 *  so React Aria's own slide never runs between pages; this lets the new page's pill come
 *  in from the tab you just left. Only a fresh memory counts: coming back to the row later,
 *  from somewhere else, starts still. */
const lastPill = new Map<string, { box: Box; at: number }>();
const FRESH_MS = 4000;

/** A row of tabs where each tab is a page: HeroUI's Tabs with links. React Aria keeps the
 *  arrow-key movement and the selected state; the press goes through HeroUIProvider's
 *  router, so it is a client-side navigation like the plain links it replaces. No panels:
 *  the page under the row is the panel. Each tab is 44 px tall (`.routetabs`).
 *
 *  `current` names the tab of the page showing. When it names none of them, no tab is
 *  lit: React Aria would otherwise select the first, and a row that claims you are on a
 *  page you are not on is worse than one that says nothing. */
export default function RouteTabs({
  tabs,
  current,
  label,
  className = "",
}: {
  tabs: RouteTab[];
  current: string | undefined;
  /** What the row is: «بخش‌های سفارش‌ها». */
  label: string;
  className?: string;
}) {
  const lit = tabs.some((t) => t.href === current) ? current : undefined;
  const box = useRef<HTMLDivElement | null>(null);
  /* On a phone the row is wider than the screen; bring the lit tab into view so the page
     you are on is never the one scrolled off the end. */
  const placed = useRef(false);
  useEffect(() => {
    // A frame later: React Aria builds the tab collection in a second render pass.
    const id = requestAnimationFrame(() => {
      box.current
        ?.querySelector('[data-selected="true"]')
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
      const pill = box.current?.querySelector(".tabs__indicator");
      if (!pill) return;
      const now = boxOf(pill);
      const prev = lastPill.get(label);
      // After the first placement React Aria slides the pill itself.
      if (!placed.current && prev && Date.now() - prev.at < FRESH_MS) slidePill(pill, prev.box, now);
      placed.current = true;
      lastPill.set(label, { box: now, at: Date.now() });
    });
    return () => cancelAnimationFrame(id);
  }, [lit, label]);
  return (
    <div ref={box} className="contents">
      <Tabs
        selectedKey={lit ?? NONE}
        className={`routetabs ${className}`.trim()}
      >
        {/* The list alone, without ListContainer: the container adds scroll arrows named in
          English, and the row already scrolls sideways on its own. */}
        <Tabs.List aria-label={label}>
          {tabs.map((t) => (
            <Tabs.Tab key={t.href} id={t.href} href={t.href}>
              {t.label}
              <Tabs.Indicator />
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>
    </div>
  );
}
