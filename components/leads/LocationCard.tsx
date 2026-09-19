"use client";

import { SavedLocation } from "@/app/(shell)/leads/page";
import StarRating from "@/components/StarRating";
import CopyButton from "@/components/CopyButton";
import { Icon } from "@/components/meridian/Icon";
import { averageScore } from "@/lib/leadScore";
import { faNum } from "@/lib/format";
import { navigateUrl } from "@/lib/navApps";
import type { NavAppId } from "@/lib/navApps";

const STATUS_META: Record<string, string> = {
  contacted: "تماس گرفته شد",
  visited: "بازدید شد",
  no_answer: "پاسخ نداد",
  declined: "رد کرد",
};

export interface LocationCardProps {
  location: SavedLocation;
  inRun: boolean;
  navAppId: NavAppId;
  onCopyOriginal: () => void;
  onCopyPage: () => void;
  onPin: () => void;
  onNameChange: (name: string) => void;
  /** Position in the run (1-based). Shown as badge on the "+" button. */
  runIdx?: number | null;
  /** Click handler for the add/remove-from-run button. */
  onToggleRun?: () => void;
  /** Whether the scoring panel is open for this row. */
  scoring?: boolean;
  onClickScoring?: () => void;
  /** Whether this row has priority-high glow. */
  priorityHigh?: boolean;
  /** Distance in km (for display). */
  km?: number | null;
}

const STATUS_COLOR: Record<string, string> = {
  contacted: "bg-green-500",
  visited: "bg-blue-500",
  no_answer: "bg-red-500",
  declined: "bg-gray-500",
};

export default function LocationCard({
  location,
  inRun,
  navAppId,
  onCopyOriginal,
  onCopyPage,
  onPin,
  onNameChange,
  runIdx,
  onToggleRun,
  scoring,
  onClickScoring,
  priorityHigh,
  km,
}: LocationCardProps) {
  const avg = averageScore(location);
  const statusColor = location.status ? STATUS_COLOR[location.status] ?? "bg-gray-400" : "bg-gray-400";
  const statusLabel = location.status ? STATUS_META[location.status] : "بدون وضعیت";

  return (
    <div
      className={`rounded-[var(--radius-md)] border bg-surface p-3 hover:border-border-strong transition-colors
        ${priorityHigh ? "border-accent shadow-sm" : ""}`}
    >
      <div className="flex items-start gap-3">
        <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${statusColor}`} title={statusLabel} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <input
              type="text"
              defaultValue={location.name}
              onBlur={(e) => onNameChange(e.target.value)}
              className="bg-transparent text-text font-medium text-[length:var(--text-sm)] outline-none border-b border-transparent focus:border-accent min-w-0 flex-1"
            />
            {inRun && (
              <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[length:var(--text-xs)] text-accent">
                در مسیر
              </span>
            )}
            {location.lat === null && (
              <span className="shrink-0 rounded bg-border px-1.5 py-0.5 text-[length:var(--text-xs)] text-text-faint">
                بدون مخصرات
              </span>
            )}
          </div>
          {location.address && (
            <p className="truncate text-[length:var(--text-xs)] text-text-faint mt-0.5">{location.address}</p>
          )}
          <div className="mt-1 flex items-center gap-3">
            <StarRating value={avg} onChange={(v: number | null) => {}} label="امتیاز" disabled />
            <span className="text-[length:var(--text-xs)] text-text-faint">{statusLabel}</span>
            {avg !== null && (
              <span className="font-mono text-[length:var(--text-xs)] text-warn">
                {faNum(Math.round(avg * 10) / 10)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* action bar — add/remove, status, tap-flow, copy, pin */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {onToggleRun && (
          <button
            type="button"
            onClick={onToggleRun}
            disabled={location.lat === null || location.lng === null}
            aria-label={inRun ? `حذف ${location.name} از مسیر` : `افزودن ${location.name} به مسیر`}
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-[length:var(--text-xs)] transition-colors disabled:opacity-30
              ${inRun
                ? "border-accent bg-accent text-accent-ink"
                : "border-border text-text-muted hover:border-accent hover:text-accent"
              }`}
          >
            {inRun && runIdx !== null ? faNum(runIdx + 1) : "+"}
          </button>
        )}

        {location.lat !== null && location.lng !== null && (
          <button
            type="button"
            onClick={() => window.open(navigateUrl(navAppId, { lat: location.lat!, lng: location.lng! }, location.name), "_blank")}
            className="whitespace-nowrap rounded-[var(--radius-sm)] px-4 py-1.5 text-[length:var(--text-sm)] text-accent transition-colors hover:bg-white/5 inline-flex items-center gap-3"
          >
            <Icon name="external-link" size="sm" /> مسیریابی
          </button>
        )}
        <CopyButton value={location.maps_url} what="کپی لینک اصلی" />
        <CopyButton value={() => `${window.location.origin}/leads?l=${location.id}`} what="کپی پیوند این مکان" />
        <button
          type="button"
          onClick={onPin}
          className="rounded-[var(--radius-sm)] px-2 py-1 text-[length:var(--text-xs)] text-text-faint hover:border-accent hover:text-accent transition-colors"
        >
          <Icon name="map-pin" size="sm" />
        </button>
        {onClickScoring && (
          <button
            type="button"
            onClick={onClickScoring}
            className="rounded-[var(--radius-sm)] px-1.5 py-1 text-[length:var(--text-xs)] text-text-faint hover:border-accent hover:text-accent transition-colors"
            aria-label="امتیازدهی"
          >
            <Icon name="star" size="sm" />
          </button>
        )}
      </div>
    </div>
  );
}
