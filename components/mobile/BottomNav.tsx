"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import BottomSheet from "@/components/mobile/BottomSheet";
import { TAB_ICON, type BottomTabs } from "@/lib/mobileNav";
import { currentTab } from "@/lib/appNav";

/** The phone's navigation bar: the four places a role goes dozens of times a day, and «بیشتر»
 *  for everything else (grouped the way the desk menu groups it). Phone only -- the desk pill
 *  in the header is unchanged from md up, and below it is hidden by CSS, so the bar and the pill
 *  never both show.
 *
 *  Every item is icon AND word. The active item is the longest-prefix match, so
 *  /sales/orders/12 lights «سفارش‌ها». */
export default function BottomNav({ primary, more, account }: BottomTabs) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const current = currentTab(pathname, primary)?.href;
  /* If the page is one of the «more» destinations, «بیشتر» is the lit item. */
  const inMore =
    !current &&
    (currentTab(pathname, more.flatMap((g) => g.tabs)) !== undefined ||
      account.some((l) => pathname === l.href || pathname.startsWith(`${l.href}/`)));

  return (
    <>
      <nav className="bottomnav" aria-label="ناوبری اصلی">
        {primary.map((t) => (
          <Link key={t.href} href={t.href} className="bottomnav__item" aria-current={t.href === current ? "page" : undefined}>
            <Icon name={TAB_ICON[t.href] ?? "dot"} size="md" />
            <span>{t.label}</span>
          </Link>
        ))}
        {(more.length > 0 || account.length > 0) && (
          <button type="button" className="bottomnav__item" aria-haspopup="dialog" aria-current={inMore ? "page" : undefined} onClick={() => setMoreOpen(true)}>
            <Icon name="menu" size="md" />
            <span>بیشتر</span>
          </button>
        )}
      </nav>
      <BottomSheet open={moreOpen} title="همهٔ بخش‌ها" onClose={() => setMoreOpen(false)} closeLabel="بستن فهرست بخش‌ها">
        {more.map((g) => (
          <section key={g.id} className="mobilemore__group">
            <div className="tf-group">{g.label}</div>
            <div className="tf-grid one">
              {g.tabs.map((t) => (
                <Link
                  key={t.href}
                  href={t.href}
                  className="inline-flex items-center justify-center gap-[var(--space-2)] tf-opt"
                  onClick={() => setMoreOpen(false)}
                >
                  <Icon name="arrow-left" size="md" />
                  {t.label}
                </Link>
              ))}
            </div>
          </section>
        ))}
        {account.length > 0 && (
          <section className="mobilemore__group">
            <div className="tf-group">حساب من</div>
            <div className="tf-grid one">
              {account.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="inline-flex items-center justify-center gap-[var(--space-2)] tf-opt"
                  onClick={() => setMoreOpen(false)}
                >
                  <Icon name={l.icon} size="md" />
                  {l.label}
                </Link>
              ))}
            </div>
          </section>
        )}
      </BottomSheet>
    </>
  );
}
