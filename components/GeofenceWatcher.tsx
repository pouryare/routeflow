"use client";

import { useEffect, useRef, useState } from "react";
import { CustomerRow } from "@/lib/types";
import { distanceKm } from "@/lib/geo";
import { useToast } from "./ToastProvider";

const TRIGGER_RADIUS_KM = 0.15; // 150m
const SNOOZE_MS = 30 * 60 * 1000; // don't re-prompt the same customer for 30 minutes

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function GeofenceWatcher({
  enabled,
  customers,
  onPosition,
}: {
  enabled: boolean;
  customers: CustomerRow[];
  onPosition?: (lat: number, lng: number) => void;
}) {
  const [nearby, setNearby] = useState<CustomerRow | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const snoozedRef = useRef(new Map<number, number>());
  const customersRef = useRef(customers);
  customersRef.current = customers;
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
        const match = customersRef.current
          .filter((c) => c.lat && c.lng)
          .map((c) => ({ c, km: distanceKm({ lat: latitude, lng: longitude }, { lat: c.lat as number, lng: c.lng as number }) }))
          .filter(({ c, km }) => {
            if (km > TRIGGER_RADIUS_KM) return false;
            const snoozedAt = snoozedRef.current.get(c.id);
            return !snoozedAt || now - snoozedAt > SNOOZE_MS;
          })
          .sort((a, b) => a.km - b.km)[0];
        if (match) setNearby((prev) => prev ?? match.c);
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
  }, [enabled]);

  function dismiss() {
    if (nearby) snoozedRef.current.set(nearby.id, Date.now());
    setNearby(null);
  }

  async function confirmVisit() {
    if (!nearby) return;
    setSaving(true);
    try {
      const res = await fetch("/api/visit-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity_type: "customer", entity_id: nearby.id, planned_date: todayStr() }),
      });
      const data = await res.json();
      if (data.ok) {
        await fetch(`/api/visit-plans/${data.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "done" }),
        });
        toast(`بازدید از «${nearby.business_name}» ثبت شد.`, "success");
      } else {
        toast("خطا در ثبت بازدید", "error");
      }
      snoozedRef.current.set(nearby.id, Date.now());
    } finally {
      setSaving(false);
      setNearby(null);
    }
  }

  if (!nearby) return null;

  return (
    <div
      dir="rtl"
      className="absolute bottom-4 left-1/2 z-[1001] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-[var(--radius-lg)] border border-accent bg-surface-raised p-3 elevate-accent"
    >
      <p className="text-[length:var(--text-sm)] text-text">
        شما نزدیک <span className="font-medium text-accent">{nearby.business_name}</span> هستید — بازدید ثبت شود؟
      </p>
      <div className="mt-2 flex gap-2">
        <button
          onClick={confirmVisit}
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
