"use client";

import { useRunAfterMount } from "@/lib/useRunAfterMount";
import { useCallback, useEffect, useState } from "react";
import { distanceKm, formatDistanceKm } from "@/lib/geo";
import { faNum } from "@/lib/format";
import { useToast } from "./ToastProvider";
import { useNavApp } from "./NavAppSetting";
import { navigateUrl } from "@/lib/navApps";
import { Icon } from "@/components/meridian/Icon";

interface PlanRow {
  id: number;
  entity_type: "district" | "customer" | "facility" | "lead_location";
  entity_id: number;
  planned_date: string;
  status: "planned" | "done" | "skipped";
  sort_order: number;
  label: string;
  lat: number | null;
  lng: number | null;
}

function todayStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The next unfinished stop on today's plan, pinned to the bottom of the map.
 *
 *  Answering "where am I going next" used to mean leaving the map for the planner and
 *  then coming back. That is a page navigation performed at the wheel, for one line of
 *  text, and it is the single most repeated question of a delivery day.
 *
 *  Absent rather than empty when there is no plan for today: a bar saying "no stops"
 *  occupies the same space as a bar saying something, and this one sits over the map.
 */
export default function NextStopBar({
  enabled,
  myPosition,
  onFocus,
  onDismiss,
}: {
  /** Owned by the sidebar so dismissing is reversible. A bar you can hide with no way
   *  to bring it back is a bar you lose. */
  enabled: boolean;
  myPosition: { lat: number; lng: number } | null;
  /** Opens the stop on the map. Only called for stops that have coordinates. */
  onFocus: (entityId: number, lat: number, lng: number) => void;
  onDismiss: () => void;
}) {
  const [plans, setPlans] = useState<PlanRow[] | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const [navAppId] = useNavApp();

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/visit-plans?date=${todayStr()}`);
      const data = await res.json();
      setPlans(data.plans ?? []);
    } catch {
      // A failed poll leaves the previous answer standing rather than blanking the bar:
      // a stale next stop is far more useful at the wheel than no next stop.
    }
  }, []);

  useRunAfterMount(load);

  // The plan changes from the planner page, from the geofence prompt, and from the
  // detail panel's "+ برنامه امروز". Refreshing when the tab regains focus covers all
  // three without a poll running while the phone is in a pocket.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") load();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", load);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", load);
    };
  }, [load]);

  const remaining = (plans ?? []).filter((p) => p.status === "planned");
  const next = remaining[0] ?? null;
  const doneCount = (plans ?? []).filter((p) => p.status === "done").length;

  async function markDone() {
    if (!next) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/visit-plans/${next.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      });
      if (!res.ok) throw new Error();
      toast(`«${next.label}» انجام شد.`, "success", {
        label: "بازگردان",
        onClick: async () => {
          await fetch(`/api/visit-plans/${next.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "planned" }),
          });
          load();
        },
      });
      await load();
    } catch {
      toast("خطا در ثبت وضعیت", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!enabled || !next) return null;

  const km = myPosition && next.lat !== null && next.lng !== null
    ? distanceKm(myPosition, { lat: next.lat, lng: next.lng })
    : null;

  // Shares its resting place with the arrival prompt, which outranks it in the stacking
  // scale. That is deliberate: when the prompt is up it is about this very stop, and a
  // prompt sitting half over the bar is harder to read than one sitting cleanly on it.
  return (
    <div
      dir="rtl"
      className="pointer-events-none pinned-bottom absolute left-1/2 z-[var(--z-map-overlay)] flex w-[min(460px,calc(100vw-2rem))] -translate-x-1/2 justify-center"
    >
      <div className="pointer-events-auto flex w-full items-center gap-2 rounded-[var(--radius-lg)] border border-border-strong bg-surface-raised/95 px-3 py-2 backdrop-blur elevate-accent">
        <span className="shrink-0 font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-faint">
          بعدی
        </span>

        <button
          onClick={() => next.lat !== null && next.lng !== null && onFocus(next.entity_id, next.lat, next.lng)}
          disabled={next.lat === null || next.lng === null}
          className="min-w-0 flex-1 text-right transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-accent disabled:hover:text-text"
        >
          <span className="block truncate text-[length:var(--text-sm)] font-medium text-text">{next.label}</span>
          {/* Each fact in its own element rather than one string joined by "·". In an
              RTL line a bare separator between Persian text and a numeral gets reordered
              by the bidi algorithm and lands on the wrong side of the count. */}
          <span className="flex flex-wrap items-center gap-x-1.5 text-[length:var(--text-xs)] text-text-muted">
            {/* Straight-line, and said so: the figure is roughly half the driving
                distance in this city and a reader who takes it for road distance will
                plan the day wrong. */}
            <span>{km === null ? "برای فاصله، موقعیت را روشن کنید" : `${formatDistanceKm(km)} — خط مستقیم`}</span>
            {remaining.length > 1 && (
              <>
                <span aria-hidden="true" className="text-text-faint">·</span>
                <span>{faNum(remaining.length - 1)} توقف دیگر</span>
              </>
            )}
            {doneCount > 0 && (
              <>
                <span aria-hidden="true" className="text-text-faint">·</span>
                <span className="text-good">{faNum(doneCount)} انجام‌شده</span>
              </>
            )}
          </span>
        </button>

        {next.lat !== null && next.lng !== null && (
          <a
            href={navigateUrl(navAppId, { lat: next.lat, lng: next.lng }, next.label)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="مسیریابی به این توقف"
            className="shrink-0 whitespace-nowrap inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-accent px-5 py-2 text-[length:var(--text-sm)] font-medium text-accent transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-accent hover:text-accent-ink"
          >
            نقشه
          </a>
        )}

        <button
          onClick={markDone}
          disabled={saving}
          aria-label="انجام شد"
          title="انجام شد"
          className="shrink-0 rounded-[var(--radius-sm)] border border-border px-2 py-1.5 text-[length:var(--text-xs)] text-good transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-good disabled:opacity-50"
        >
          <Icon name="check" size="sm" />
        </button>

        <button
          onClick={onDismiss}
          aria-label="پنهان کردن نوار توقف بعدی"
          className="shrink-0 text-text-faint transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-text"
        >
          <Icon name="x" size="sm" />
        </button>
      </div>
    </div>
  );
}
