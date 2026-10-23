"use client";

import Link from "next/link";
import StatePage from "@/components/meridian/StatePage";
import { Icon } from "@/components/meridian/Icon";

/** What the service worker serves when a page is not cached and there is no connection.
 *  On the shared StatePage like the 404 and the error pages; the eyebrow used to be the
 *  English word «Offline». The bare layout provides the `.meridian` scope.
 *
 *  The worker answers the address the reader asked for with this page, so a reload is a
 *  retry of THAT page, which is what someone whose signal just came back wants. The second
 *  button used to be «بازگشت به نقشه»: a driver cannot open /map and it is nobody's home.
 *  `/` sends each role to its own start (app/page.tsx), and needs no session read here,
 *  which a page cached at install time could not do anyway. */
export default function OfflinePage() {
  return (
    <StatePage
      icon="satellite"
      eyebrow="بدون اتصال"
      title="این صفحه بدون اینترنت در دسترس نیست"
      hint="صفحه‌هایی که قبلاً باز کرده‌اید ممکن است همچنان دیده شوند. وقتی اتصال برقرار شد دوباره تلاش کنید."
      actions={
        <>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-[var(--space-2)] btn solid"
            onClick={() => location.reload()}
          >
            <Icon name="undo" size="md" />
            تلاش دوباره
          </button>
          <Link className="inline-flex items-center justify-center gap-[var(--space-2)] btn" href="/">
            <Icon name="compass" size="md" />
            صفحهٔ اصلی
          </Link>
        </>
      }
    />
  );
}
