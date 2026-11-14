"use client";

import { useCallback, useEffect, useState } from "react";
import { Marker, Popup } from "@vis.gl/react-maplibre";
import { useRunAfterMount } from "@/lib/useRunAfterMount";
import { onLive, onLiveOpen } from "@/lib/live/client";
import { ageLabel, isStale } from "@/lib/vanPositions";
import { Icon } from "@/components/meridian/Icon";
import type { VanDot } from "@/lib/repo/vanPositions";

type Dot = { id: number; name: string; lat: number; lng: number; at: string };

/** F6: drivers on a run, live, for the owner and managers. Each dot says how old it is and turns grey when the
 *  phone has gone quiet; the list refetches on every (re)connect and a new position moves its dot at once. */
export default function VanMarkers() {
  const [dots, setDots] = useState<Dot[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const res = await fetch("/api/sales/vans").catch(() => null);
    if (!res?.ok) return;
    const j = (await res.json().catch(() => null)) as { vans?: VanDot[] } | null;
    setDots((j?.vans ?? []).map((v) => ({ id: v.user_id, name: v.name, lat: v.lat, lng: v.lng, at: v.recorded_at })));
  }, []);

  useRunAfterMount(load);

  useEffect(() => {
    const offOpen = onLiveOpen(() => void load());
    const off = onLive("van.pos", (d) => {
      const m = d as { u?: number; n?: string; la?: number; ln?: number; at?: string } | null;
      if (!m || typeof m.u !== "number" || typeof m.la !== "number" || typeof m.ln !== "number" || typeof m.at !== "string") return;
      const next: Dot = { id: m.u, name: m.n ?? "راننده", lat: m.la, lng: m.ln, at: m.at };
      setDots((all) => (all.some((x) => x.id === next.id) ? all.map((x) => (x.id === next.id ? next : x)) : [...all, next]));
    });
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      offOpen();
      off();
      clearInterval(tick);
    };
  }, [load]);

  const open = dots.find((d) => d.id === openId);
  return (
    <>
      {dots.map((d) => {
        const stale = isStale(now - Date.parse(d.at));
        return (
          <Marker key={d.id} longitude={d.lng} latitude={d.lat} style={{ zIndex: 3 }} onClick={(e) => { e.originalEvent.stopPropagation(); setOpenId(d.id); }}>
            <button type="button" aria-label={`${d.name}، ${ageLabel(now - Date.parse(d.at))}`} className="flex h-11 w-11 items-center justify-center bg-transparent p-0">
              <span
                className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-white shadow"
                style={{ background: stale ? "var(--muted)" : "var(--success)" }}
              >
                <Icon name="map-pin" size="sm" />
              </span>
            </button>
          </Marker>
        );
      })}
      {open && (
        <Popup longitude={open.lng} latitude={open.lat} offset={22} closeOnClick={false} onClose={() => setOpenId(null)}>
          <div dir="rtl" className="text-[length:var(--text-sm)]">
            <p className="font-medium text-text">{open.name}</p>
            <p className="mt-1 text-[length:var(--text-xs)] text-text-muted">آخرین موقعیت: {ageLabel(now - Date.parse(open.at))}{isStale(now - Date.parse(open.at)) ? " (گوشی ساکت است)" : ""}</p>
          </div>
        </Popup>
      )}
    </>
  );
}
