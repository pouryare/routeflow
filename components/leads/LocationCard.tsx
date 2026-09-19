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
}: LocationCardProps) {
  const avg = averageScore(location);
  const statusColor = location.status ? STATUS_COLOR[location.status] ?? "bg-gray-400" : "bg-gray-400";
  const statusLabel = location.status ? STATUS_META[location.status] : "بدون وضعیت";

  return (
    <div className="rounded-[var(--radius-md)] border border-border bg-surface p-3 hover:border-border-strong transition-colors">
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
      <div className="mt-2 flex flex-wrap gap-1.5">
        {location.lat !== null && location.lng !== null && (
          <button
            type="button"
            onClick={() => window.open(navigateUrl(navAppId, { lat: location.lat!, lng: location.lng! }, location.name), "_blank")}
            className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-faint hover:border-accent hover:text-accent transition-colors"
          >
            <Icon name="external-link" size="sm" /> مسیریابی
          </button>
        )}
        <CopyButton value={location.maps_url} what="کپی لینک اصلی" />
        <CopyButton value={() => `${window.location.origin}/leads?l=${location.id}`} what="کپی پیوند این مکان" />
        <button
          type="button"
          onClick={onPin}
          className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-faint hover:border-accent hover:text-accent transition-colors"
        >
          <Icon name="map-pin" size="sm" />
        </button>
      </div>
    </div>
  );
}
