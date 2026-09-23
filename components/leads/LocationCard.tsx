"use client";

import { SavedLocation } from "@/app/(shell)/leads/hooks/useLeads";
import StarRating from "@/components/StarRating";
import CopyButton from "@/components/CopyButton";
import { Icon } from "@/components/meridian/Icon";
import { averageScore } from "@/lib/leadScore";
import { faNum } from "@/lib/format";
import { navigateUrl } from "@/lib/navApps";
import type { NavAppId } from "@/lib/navApps";
import { useState } from "react";

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
  onCopyOriginal?: () => void;
  onCopyPage?: () => void;
  onPin: () => void;
  onNameChange: (name: string) => void;
  /** Position in the run (1-based). Shown as badge on the "+" button. */
  runIdx?: number | null;
  /** Click handler for the add/remove-from-run button. */
  onToggleRun?: () => void;
  /** Whether this row has priority-high glow. */
  priorityHigh?: boolean;
  /** Distance in km (for display). */
  km?: number | null;
  onTogglePriority?: () => void;
  /** Open the planner with this lead added to today's plan. */
  onAddToPlan?: () => void;
  /** Notes for this location. */
  notes?: string | null;
  onNotesChange?: (notes: string) => void;
  /** Tighter padding for grid/kanban views. */
  compactMode?: boolean;
  /** Show checkbox for batch selection. */
  showCheckboxes?: boolean;
  /** Whether this item is checked in batch mode. */
  checked?: boolean;
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
  onPin,
  onNameChange,
  runIdx,
  onToggleRun,
  priorityHigh,
  km,
  onTogglePriority,
  onAddToPlan,
  notes,
  onNotesChange,
  compactMode = false,
  showCheckboxes = false,
  checked = false,
}: LocationCardProps) {
  const avg = averageScore(location);
  const statusColor = location.status ? STATUS_COLOR[location.status] ?? "bg-gray-400" : "bg-gray-400";
  const statusLabel = location.status ? STATUS_META[location.status] : "بدون وضعیت";

  return (
    <div
      className={`rounded-[var(--radius-md)] border border-[var(--line)] bg-surface p-3 hover:border-[var(--line-2)] transition-colors ${compactMode ? "p-2" : ""}
        ${priorityHigh ? "border-accent shadow-sm" : ""}`}
    >
      <div className="flex items-start gap-3">
        {showCheckboxes && (
          <input
            type="checkbox"
            checked={checked}
            onChange={() => {}}
            className="mt-1 h-4 w-4 shrink-0 rounded border-border accent-accent cursor-pointer"
          />
        )}
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

      {/* action bar — route, copy, pin, add/remove */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {onToggleRun && (
          <button
            type="button"
            onClick={onToggleRun}
            disabled={location.lat === null || location.lng === null}
            aria-label={inRun ? `حذف ${location.name} از مسیر` : `افزودن ${location.name} به مسیر`}
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border font-mono text-[length:var(--text-xs)] transition-colors disabled:opacity-30
              ${inRun
                ? "border-accent bg-accent text-accent-ink"
                : "border-border text-text-muted hover:border-accent hover:text-accent"
              }`}
          >
            {runIdx != null ? faNum(runIdx) : "+"}
          </button>
        )}

        {location.lat != null && location.lng != null && (
          <a
            href={navigateUrl(navAppId, { lat: location.lat!, lng: location.lng! }, location.name)}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-[var(--radius-sm)] border border-border px-2.5 py-1.5 text-[length:var(--text-xs)] text-accent transition-colors hover:border-accent hover:text-accent inline-flex items-center gap-1.5"
          >
            <Icon name="route" size="sm" /> مسیریابی
          </a>
        )}

        <CopyButton value={location.maps_url} label="لینک اصلی" what="کپی لینک اصلی" className="px-2.5 py-1.5" />
        <CopyButton value={() => `${window.location.origin}/leads?l=${location.id}`} label="پیوند" what="کپی پیوند این مکان" className="px-2.5 py-1.5" />

        <button
          type="button"
          onClick={onPin}
          className="rounded-[var(--radius-sm)] border border-border px-2.5 py-1.5 text-[length:var(--text-xs)] text-text-faint hover:border-accent hover:text-accent transition-colors inline-flex items-center gap-1.5"
        >
          <Icon name="map-pin" size="sm" /> ویرایش مکان
        </button>

        {onTogglePriority && (
          <button
            type="button"
            onClick={onTogglePriority}
            className={`rounded-[var(--radius-sm)] border px-2 py-1.5 text-[length:var(--text-xs)] transition-colors inline-flex items-center gap-1.5
              ${location.priority
                ? "border-accent bg-accent text-accent-ink"
                : "border-border text-text-faint hover:border-accent hover:text-accent"
              }`}
          >
            <Icon name={location.priority ? "star" : "star-off"} size="sm" />
            {location.priority ? "اولیوت بالا" : "اولیوت بالا نیست"}
          </button>
        )}

        {onAddToPlan && (
          <button
            type="button"
            onClick={onAddToPlan}
            className="rounded-[var(--radius-sm)] border border-accent bg-accent/10 px-2 py-1.5 text-[length:var(--text-xs)] text-accent transition-colors hover:bg-accent hover:text-accent-ink inline-flex items-center gap-1.5"
          >
            <Icon name="calendar" size="sm" /> افزودن به برنامه
          </button>
        )}
      </div>

      {onNotesChange && (
        <div className="mt-2 pt-2 border-t border-border">
          <textarea
            value={notes ?? ""}
            onChange={(e) => onNotesChange(e.target.value)}
            placeholder="یادداشت…"
            rows={2}
            className="w-full rounded-[var(--radius-sm)] border border-border bg-transparent px-2 py-1 text-[length:var(--text-sm)] text-text outline-none focus:border-accent resize-none placeholder:text-text-faint"
          />
        </div>
      )}

    </div>
  );
}
