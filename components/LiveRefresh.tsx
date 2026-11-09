"use client";

/** Re-renders the page's server data when the live stream says something on it changed (issue #58,
 *  idea L1). Example: Sara has the orders list open; Reza marks order 1042 delivered on his phone,
 *  and her list shows it within a second, with no pull-to-refresh.
 *
 *  Renders nothing. A burst of events (a run of ten stops closed together) becomes one refresh, and
 *  a reconnect refreshes once too, since anything may have changed while the stream was down.
 *  router.refresh() keeps what the person typed or opened: only server data is fetched again.
 *  A hidden tab does not refresh (a whole page of data for a screen nobody sees); it refreshes once
 *  when it is shown again, if anything arrived meanwhile. */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { onLive, onLiveOpen } from "@/lib/live/client";

const SETTLE_MS = 400;

export default function LiveRefresh({ topics, id }: { topics: string[]; /** Only events about this record (and bulk changes). */ id?: number }) {
  const router = useRouter();
  const key = topics.join(",");
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let waiting = false; // news arrived while the tab was hidden
    const mountedAt = Date.now();
    const refresh = (data?: unknown) => {
      const ev = data as { id?: unknown; bulk?: unknown } | null | undefined;
      if (id !== undefined && ev && !ev.bulk && ev.id !== id) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (document.visibilityState === "visible") router.refresh();
        else waiting = true;
      }, SETTLE_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && waiting) {
        waiting = false;
        router.refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    const offs = key.split(",").map((t) => onLive(t, refresh));
    // The first connection comes with the page itself; only a later one means "you were away".
    offs.push(onLiveOpen(() => Date.now() - mountedAt > 3000 && refresh()));
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      offs.forEach((off) => off());
    };
  }, [key, id, router]);
  return null;
}
