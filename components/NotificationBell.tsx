"use client";

/** A fixed island in the bottom-start corner (RTL -> visually bottom-right), opposite the
 *  SyncStatus island (bottom-left) so the two never overlap. Polls GET /api/notifications
 *  every 60s for the unread count; a 401/403 (logged out, or a role the feed does not
 *  serve) flips `authed` off and the component renders nothing. Browser glue -- not
 *  unit-tested, per repo convention.
 */

import { useState } from "react";
import { faNum } from "@/lib/format";
import { useUnreadCount } from "@/lib/useUnreadCount";
import NotificationCenter from "./NotificationCenter";

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { unread, authed, setUnread } = useUnreadCount();

  if (!authed) return null;

  return (
    <div className="fixed bottom-[var(--space-4)] right-[var(--space-4)] z-40" dir="rtl">
      {open && (
        <div className="mb-[var(--space-2)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-3)]">
          <NotificationCenter onUnread={setUnread} />
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="اعلان‌ها"
        aria-expanded={open}
        className="relative grid h-11 w-11 place-items-center rounded-full border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-2)] transition-transform duration-[var(--dur-base)] ease-[var(--ease-out)] hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      >
        <span aria-hidden className="text-[length:var(--text-lg)]">
          🔔
        </span>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 grid min-w-[1.15rem] place-items-center rounded-full bg-[var(--accent)] px-1 text-[length:var(--text-xs)] font-bold text-[var(--accent-ink)]">
            {unread > 9 ? "۹+" : faNum(unread)}
          </span>
        )}
      </button>
    </div>
  );
}
