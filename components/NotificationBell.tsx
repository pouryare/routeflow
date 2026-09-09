"use client";

/** The notification bell, in one of two placements -- see `placement`.
 *
 *  It began as a fixed island in the bottom-start corner (RTL -> visually bottom-right),
 *  opposite the SyncStatus island so the two never overlap; that is still what a bare
 *  route gets. Inside the shell it sits in the top bar beside the profile, which is
 *  where people look for it. Polls GET /api/notifications
 *  every 60s for the unread count; a 401/403 (logged out, or a role the feed does not
 *  serve) flips `authed` off and the component renders nothing. Browser glue -- not
 *  unit-tested, per repo convention.
 */

import { useEffect, useState } from "react";
import { faNum } from "@/lib/format";
import NotificationCenter from "./NotificationCenter";
import { Icon } from "@/components/meridian/Icon";

export default function NotificationBell({
  placement = "floating",
}: {
  /** "header" mounts it inline in the shell's top bar beside the profile; "floating"
   *  keeps the original bottom-corner island, which the bare routes still use. */
  placement?: "header" | "floating";
} = {}) {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [authed, setAuthed] = useState(true);

  // Poll the unread count on an interval so the badge stays live without a socket.
  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const res = await fetch("/api/notifications");
        if (!alive) return;
        if (!res.ok) {
          // 401 (logged out) or 403 (role not permitted) -> the bell has nothing to show.
          if (res.status === 401 || res.status === 403) setAuthed(false);
          return;
        }
        if (res.ok) {
          const j = await res.json();
          setUnread(j.unread ?? 0);
        }
      } catch {
        /* transient; next tick retries */
      }
    }
    void tick();
    const h = setInterval(tick, 60_000);
    return () => {
      alive = false;
      clearInterval(h);
    };
  }, []);

  if (!authed) return null;

  /* Two placements, one component. "floating" is the original bottom-corner island and
     is what the bare routes (/driver) still use. "header" is the shell's: inline in the
     top bar beside the profile, with the panel hanging below it instead of above. */
  const inHeader = placement === "header";

  return (
    <div
      className={
        inHeader
          ? "relative"
          : "fixed bottom-[var(--space-4)] right-[var(--space-4)] z-40"
      }
      dir="rtl"
    >
      {open && (
        <div
          className={
            inHeader
              ? "absolute top-[calc(100%+8px)] inset-inline-end-0 z-50 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-3)]"
              : "mb-[var(--space-2)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-3)]"
          }
        >
          <NotificationCenter onUnread={setUnread} />
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="اعلان‌ها"
        aria-expanded={open}
        className={
          inHeader
            ? "relative grid h-[34px] w-[34px] place-items-center rounded-full text-[var(--muted)] transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-[var(--ink)]"
            : "relative grid h-11 w-11 place-items-center rounded-full border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-2)] transition-transform duration-[var(--dur-base)] ease-[var(--ease-out)] hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
        }
      >
        <Icon name="bell" size={inHeader ? "md" : "lg"} />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 grid min-w-[1.15rem] place-items-center rounded-full bg-[var(--accent)] px-1 text-[length:var(--text-xs)] font-bold text-[var(--accent-ink)]">
            {unread > 9 ? "۹+" : faNum(unread)}
          </span>
        )}
      </button>
    </div>
  );
}
