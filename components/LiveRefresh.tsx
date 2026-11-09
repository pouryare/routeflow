"use client";

/** Re-renders the page's server data when the live stream says something on it changed (issue #58,
 *  idea L1). Example: Sara has the orders list open; Reza marks order 1042 delivered on his phone,
 *  and her list shows it within a second, with no pull-to-refresh.
 *
 *  Renders nothing. A burst of events (a run of ten stops closed together) becomes one refresh, and
 *  a reconnect refreshes once too, since anything may have changed while the stream was down.
 *  router.refresh() keeps what the person typed or opened: only server data is fetched again. */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { onLive, onLiveOpen } from "@/lib/live/client";

const SETTLE_MS = 400;

export default function LiveRefresh({ topics, id }: { topics: string[]; /** Only events about this record (and bulk changes). */ id?: number }) {
  const router = useRouter();
  const key = topics.join(",");
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const mountedAt = Date.now();
    const refresh = (data?: unknown) => {
      const ev = data as { id?: unknown; bulk?: unknown } | null | undefined;
      if (id !== undefined && ev && !ev.bulk && ev.id !== id) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), SETTLE_MS);
    };
    const offs = key.split(",").map((t) => onLive(t, refresh));
    // The first connection comes with the page itself; only a later one means "you were away".
    offs.push(onLiveOpen(() => Date.now() - mountedAt > 3000 && refresh()));
    return () => {
      if (timer) clearTimeout(timer);
      offs.forEach((off) => off());
    };
  }, [key, id, router]);
  return null;
}
