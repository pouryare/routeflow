"use client";

import { useEffect, useState } from "react";

/** Polls GET /api/notifications every 60s for the unread count. A 401/403 (logged out,
 *  or a role the feed does not serve) flips `authed` off -- extracted from
 *  NotificationBell.tsx so the rail's alert icon and the notification island read the
 *  SAME count instead of running two independent polling loops that can drift out of
 *  step with each other. `setUnread` is exposed too: NotificationCenter reports back a
 *  fresher count the moment something is marked read, which should not have to wait for
 *  the next 60s tick. */
export function useUnreadCount(): {
  unread: number;
  authed: boolean;
  setUnread: (n: number) => void;
} {
  const [unread, setUnread] = useState(0);
  const [authed, setAuthed] = useState(true);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const res = await fetch("/api/notifications");
        if (!alive) return;
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) setAuthed(false);
          return;
        }
        const j = await res.json();
        setUnread(j.unread ?? 0);
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

  return { unread, authed, setUnread };
}
