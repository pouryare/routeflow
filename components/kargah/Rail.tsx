"use client";

import { useRef } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { ChevronRight, CalendarDays, MapPin, Bell } from "lucide-react";
import { useDockMagnify } from "@/lib/design/dockMagnify";
import { useUnreadCount } from "@/lib/useUnreadCount";
import ThemeToggle3 from "@/components/kargah/ThemeToggle3";
import { cn } from "@/lib/cn";

/** The left icon rail, spec 2026-09-08 §9a: a back chevron separated at the top, the
 *  app's real verbs in the middle, the three-state theme control at the foot.
 *
 *  SCOPE NOTE: the video's frame shows nine icons (share/export/star/add/mobile/data/
 *  calendar/send/alerts). This rail ships the four that have a real destination in this
 *  app today -- calendar, map, alerts (plus back) -- rather than five inert icons with
 *  no click behaviour. The rest wait for a real feature to exist behind them; see
 *  MASTER.md's "Kit primitives not yet wired" / deferred-sub-projects notes.
 *
 *  Magnification-on-proximity is useDockMagnify (lib/design/dockMagnify.ts) writing
 *  --dock-scale onto each [data-dock-item] from one delegated pointermove listener.
 */
export default function Rail({ className }: { className?: string }) {
  const rail = useRef<HTMLElement | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const { unread, authed } = useUnreadCount();
  useDockMagnify(rail);

  // RTL: "back" points visually left, which is the LTR-style ChevronRight glyph under
  // dir="rtl" -- see notch.ts's own side-resolution comment for the same inversion.
  const BackIcon = ChevronRight;

  return (
    <nav ref={rail as React.RefObject<HTMLElement>} className={cn("rail", className)} aria-label="ابزارهای کناری" dir="rtl">
      <button
        type="button"
        data-dock-item
        className="rail__item rail__back"
        aria-label="بازگشت"
        onClick={() => router.back()}
      >
        <BackIcon size={18} aria-hidden />
      </button>

      <div className="rail__group">
        <Link
          href="/sales/schedule"
          data-dock-item
          className="rail__item"
          aria-current={pathname.startsWith("/sales/schedule") ? "page" : undefined}
          aria-label="برنامهٔ بازدید"
        >
          <CalendarDays size={18} aria-hidden />
        </Link>
        <Link href="/map" data-dock-item className="rail__item" aria-label="نقشهٔ پوشش">
          <MapPin size={18} aria-hidden />
        </Link>
        {authed && (
          <Link href="/settings/notifications" data-dock-item className="rail__item rail__alerts" aria-label="اعلان‌ها">
            <Bell size={18} aria-hidden />
            {unread > 0 && <span className="rail__dot" aria-hidden />}
          </Link>
        )}
      </div>

      <ThemeToggle3 className="theme3 rail__foot" />
    </nav>
  );
}
