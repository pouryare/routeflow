"use client";

import { useEffect, useRef, useState } from "react";
import { CustomerRow } from "@/lib/types";
import type { FacilityRow } from "@/lib/facilityTypes";
import { distanceKm } from "@/lib/geo";
import { useToast } from "./ToastProvider";

const TRIGGER_RADIUS_KM = 0.15; // 150m
// A warehouse yard is a bigger target than a shopfront, and the useful moment is
// "pulling in", not "standing at the door".
const FACILITY_RADIUS_KM = 0.25;
const SNOOZE_MS = 30 * 60 * 1000; // don't re-prompt the same customer for 30 minutes
// Leaving the origin is a once-a-day event, so a much longer snooze: a lunchtime return
// home must not offer to start the day over.
const FACILITY_SNOOZE_MS = 6 * 60 * 60 * 1000;

/** What the prompt is about. Arriving at a depot and arriving at a customer are the
 *  same geofence question with different answers, so they share one watcher -- one
 *  permission, one position stream, one battery cost. */
type Prompt =
  | { kind: "customer"; customer: CustomerRow }
  | { kind: "facility_arrive"; facility: FacilityRow };

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function GeofenceWatcher({
  enabled,
  facilitiesEnabled = false,
  customers,
  facilities = [],
  onPosition,
}: {
  enabled: boolean;
  facilitiesEnabled?: boolean;
  customers: CustomerRow[];
  facilities?: FacilityRow[];
  onPosition?: (lat: number, lng: number) => void;
}) {
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const snoozedRef = useRef(new Map<string, number>());
  const customersRef = useRef(customers);
  customersRef.current = customers;
  const facilitiesRef = useRef(facilities);
  facilitiesRef.current = facilities;
  const facilitiesEnabledRef = useRef(facilitiesEnabled);
  facilitiesEnabledRef.current = facilitiesEnabled;
  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || !navigator.geolocation) {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      return;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        onPosition?.(latitude, longitude);
        const now = Date.now();
        const here = { lat: latitude, lng: longitude };
        const notSnoozed = (key: string, window: number) => {
          const at = snoozedRef.current.get(key);
          return !at || now - at > window;
        };

        // Our own sites win a tie: standing in the warehouse yard, "log a restock" is a
        // more useful offer than a visit to whatever customer happens to be next door.
        if (facilitiesEnabledRef.current) {
          const site = facilitiesRef.current
            .map((f) => ({ f, km: distanceKm(here, f) }))
            .filter(({ f, km }) => km <= FACILITY_RADIUS_KM && notSnoozed(`facility:${f.id}`, FACILITY_SNOOZE_MS))
            .sort((a, b) => a.km - b.km)[0];
          if (site) {
            setPrompt((prev) => prev ?? { kind: "facility_arrive", facility: site.f });
            return;
          }
        }

        const match = customersRef.current
          .filter((c) => c.lat && c.lng)
          .map((c) => ({ c, km: distanceKm(here, { lat: c.lat as number, lng: c.lng as number }) }))
          .filter(({ c, km }) => km <= TRIGGER_RADIUS_KM && notSnoozed(`customer:${c.id}`, SNOOZE_MS))
          .sort((a, b) => a.km - b.km)[0];
        if (match) setPrompt((prev) => prev ?? { kind: "customer", customer: match.c });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 20000, timeout: 15000 }
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, facilitiesEnabled]);

  function promptKey(p: Prompt): string {
    return p.kind === "customer" ? `customer:${p.customer.id}` : `facility:${p.facility.id}`;
  }

  function dismiss() {
    if (prompt) snoozedRef.current.set(promptKey(prompt), Date.now());
    setPrompt(null);
  }

  async function confirmVisit() {
    if (!prompt || prompt.kind !== "customer") return;
    const customer = prompt.customer;
    setSaving(true);
    try {
      const res = await fetch("/api/visit-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity_type: "customer", entity_id: customer.id, planned_date: todayStr() }),
      });
      const data = await res.json();
      if (data.ok) {
        await fetch(`/api/visit-plans/${data.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "done" }),
        });
        toast(`بازدید از «${customer.business_name}» ثبت شد.`, "success");
      } else {
        toast("خطا در ثبت بازدید", "error");
      }
      snoozedRef.current.set(`customer:${customer.id}`, Date.now());
    } finally {
      setSaving(false);
      setPrompt(null);
    }
  }

  /** Records the arrival in the shared activity log rather than as a visit plan: a stop
   *  at our own depot is something that happened, not something that was planned. Feature
   *  12 reads these back as the day's start and end. */
  async function confirmFacilityStop() {
    if (!prompt || prompt.kind !== "facility_arrive") return;
    const facility = prompt.facility;
    setSaving(true);
    try {
      const res = await fetch("/api/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_type: "facility",
          entity_id: facility.id,
          event_type: "note",
          note: facility.kind === "warehouse" ? "بارگیری از انبار" : "توقف در مبدأ",
        }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (data.ok) {
        toast(`حضور در «${facility.name}» ثبت شد.`, "success");
      } else {
        toast("خطا در ثبت حضور", "error");
      }
      snoozedRef.current.set(`facility:${facility.id}`, Date.now());
    } finally {
      setSaving(false);
      setPrompt(null);
    }
  }

  if (!prompt) return null;

  return (
    <div
      dir="rtl"
      className="absolute bottom-4 left-1/2 z-[1001] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-[var(--radius-lg)] border border-accent bg-surface-raised p-3 elevate-accent"
    >
      <p className="text-[length:var(--text-sm)] text-text">
        شما نزدیک{" "}
        <span className="font-medium text-accent">
          {prompt.kind === "customer" ? prompt.customer.business_name : prompt.facility.name}
        </span>{" "}
        هستید — {prompt.kind === "customer" ? "بازدید ثبت شود؟" : "حضور ثبت شود؟"}
      </p>
      <div className="mt-2 flex gap-2">
        <button
          onClick={prompt.kind === "customer" ? confirmVisit : confirmFacilityStop}
          disabled={saving}
          className="flex-1 rounded-[var(--radius-sm)] border border-accent bg-accent py-1.5 text-[length:var(--text-sm)] font-medium text-[#04191c] transition-[filter] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:brightness-110 disabled:opacity-50"
        >
          {saving ? "..." : "بله، ثبت شد"}
        </button>
        <button
          onClick={dismiss}
          disabled={saving}
          className="rounded-[var(--radius-sm)] border border-border px-3 py-1.5 text-[length:var(--text-sm)] text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-text disabled:opacity-50"
        >
          بعداً
        </button>
      </div>
    </div>
  );
}
