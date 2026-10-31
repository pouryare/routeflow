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

import { useEffect, useRef, useState } from "react";
import { Button, Popover } from "@heroui/react";
import { faNum } from "@/lib/format";
import NotificationCenter from "./NotificationCenter";
import { Icon } from "@/components/meridian/Icon";
import { playSound } from "@/lib/sound";
import { unreadRose } from "@/lib/unreadRose";

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
  /* A new notification swings the bell once and plays its sound; the 60 s poll is how it learns. */
  const lastUnread = useRef<number | null>(null);
  const [swing, setSwing] = useState(false);
  useEffect(() => {
    if (unreadRose(lastUnread.current, unread)) {
      setSwing(true);
      playSound("notify.new");
      const h = window.setTimeout(() => setSwing(false), 900);
      lastUnread.current = unread;
      return () => window.clearTimeout(h);
    }
    lastUnread.current = unread;
  }, [unread]);

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
     top bar beside the profile, with the panel hanging below it instead of above. The panel
     is a HeroUI Popover, which keeps it on screen by itself -- it used to be measured in
     the click that opened it, because a 22rem panel anchored to the bell ran off the phone. */
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
      <Popover isOpen={open} onOpenChange={setOpen}>
        <Button
          variant="ghost"
          isIconOnly
          aria-label="اعلان‌ها"
          className={
            inHeader
              ? "relative rounded-full text-[var(--muted)] hover:text-[var(--ink)]"
              : "relative rounded-full border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-2)]"
          }
        >
          <Icon name="bell" size={inHeader ? "md" : "lg"} className={swing ? "bell-swing" : undefined} />
          {unread > 0 && (
            <span className="absolute top-0 right-0 grid min-w-[1.15rem] place-items-center rounded-full bg-[var(--accent)] px-1 text-[length:var(--text-xs)] font-bold text-[var(--accent-ink)]">
              {unread > 9 ? "۹+" : faNum(unread)}
            </span>
          )}
        </Button>
        <Popover.Content placement={inHeader ? "bottom end" : "top end"} offset={8} className="notif-pop">
          <Popover.Dialog aria-label="اعلان‌ها" data-pane="notifications" className="notif-pop__dialog">
            <NotificationCenter onUnread={setUnread} />
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
    </div>
  );
}
