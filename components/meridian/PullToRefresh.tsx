"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/meridian/Icon";
import { playSound } from "@/lib/sound";
import { pullOffset, pullReady } from "@/lib/pullToRefresh";

/** Pull the page down from the top to refresh it (re-runs the server data of the current route).
 *  Touch only; skipped when the touch starts in a sheet or dialog, a map, or a row that scrolls
 *  sideways, and when the page is not at the top. */
export default function PullToRefresh() {
  const router = useRouter();
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef<number | null>(null);
  const live = useRef(0);
  const armed = useRef(false);

  useEffect(() => {
    const down = (e: TouchEvent) => {
      const t = e.target as HTMLElement | null;
      if (window.scrollY > 0 || busy || t?.closest('[role="dialog"], .leaflet-container, [data-no-pull], .scrollfade')) {
        start.current = null;
        return;
      }
      start.current = e.touches[0].clientY;
      armed.current = false;
    };
    const move = (e: TouchEvent) => {
      if (start.current === null) return;
      const o = pullOffset(e.touches[0].clientY - start.current);
      live.current = o;
      if (o > 0 && !armed.current) playSound("pull.stretch");
      armed.current = o > 0;
      setOffset(o);
    };
    const up = () => {
      if (start.current === null) return;
      start.current = null;
      if (pullReady(live.current)) {
        playSound("pull.release");
        setBusy(true);
        setOffset(PULL_HOLD);
        router.refresh();
        setTimeout(() => {
          playSound("refresh.done");
          setBusy(false);
          setOffset(0);
        }, 900);
      } else setOffset(0);
      live.current = 0;
    };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", up);
    window.addEventListener("touchcancel", up);
    return () => {
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
      window.removeEventListener("touchcancel", up);
    };
  }, [busy, router]);

  return (
    <div className="ptr" style={{ transform: `translateY(${offset - 48}px)`, opacity: offset > 8 ? 1 : 0 }} aria-hidden={!busy} role="status">
      <span className={`ptr__disc${busy ? " ptr__disc--busy" : ""}`} style={busy ? undefined : { transform: `rotate(${offset * 4}deg)` }}>
        <Icon name="refresh" size="md" />
      </span>
      {busy && <span className="sr-only">در حال تازه‌سازی…</span>}
    </div>
  );
}

const PULL_HOLD = 56;
