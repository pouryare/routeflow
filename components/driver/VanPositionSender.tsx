"use client";

import { useEffect, useRef } from "react";
import { useMyPosition } from "@/components/MyPositionProvider";
import { Icon } from "@/components/meridian/Icon";
import { SEND_EVERY_MS } from "@/lib/vanPositions";

/** F6: while the driver's run is in progress, the phone reports where it is every 30 seconds so the office
 *  sees the van on the map. Says so on screen, and stops the moment the run ends (the page stops mounting it).
 *  Rendered only for a run in progress; the server refuses a position without one. */
export default function VanPositionSender() {
  const { position } = useMyPosition();
  const latest = useRef(position);
  useEffect(() => {
    latest.current = position;
  }, [position]);

  useEffect(() => {
    let stopped = false;
    const send = () => {
      const p = latest.current;
      if (stopped || !p || Date.now() - p.at > 2 * SEND_EVERY_MS) return;
      void fetch("/api/driver/position", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: p.lat, lng: p.lng, accuracy: p.accuracy }),
      })
        .then((r) => {
          if (r.status === 409 || r.status === 403) stopped = true; // the run ended meanwhile, or this login may not share
        })
        .catch(() => undefined);
    };
    send();
    const id = setInterval(send, SEND_EVERY_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, []);

  return (
    <p className="m-0 mb-[var(--space-3)] flex items-center gap-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--muted)]" role="status">
      <Icon name="map-pin" size="sm" />
      تا پایان سرویس، موقعیت شما برای دفتر نمایش داده می‌شود.
    </p>
  );
}
