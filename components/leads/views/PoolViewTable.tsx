"use client";

import { useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import { averageScore } from "@/lib/leadScore";
import { faNum } from "@/lib/format";
import type { PoolViewItem } from "./PoolViewWrapper";

const STATUS_LABELS: Record<string, string> = {
  contacted: "تماس گرفته شد",
  visited: "بازدید شد",
  no_answer: "پاسخ نداد",
  declined: "رد کرد",
};

interface PoolViewTableProps {
  items: PoolViewItem[];
  selectedMapId: number | null;
  onSelect: (id: number) => void;
  onToggleRun: (id: number) => void;
  onTogglePriority: (id: number) => void;
  onPin: (id: number) => void;
  priorityHigh: boolean;
}

export default function PoolViewTable({
  items, selectedMapId, onSelect, onToggleRun, onTogglePriority, onPin, priorityHigh,
}: PoolViewTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className="sticky top-0 rounded-tl-[var(--radius-md)] bg-surface-raised px-3 py-2 text-[length:var(--text-xs)] text-text-muted text-right font-medium">#</th>
            <th className="sticky top-0 bg-surface-raised px-3 py-2 text-[length:var(--text-xs)] text-text-muted text-right font-medium">نام</th>
            <th className="sticky top-0 bg-surface-raised px-3 py-2 text-[length:var(--text-xs)] text-text-muted text-right font-medium">وضعیت</th>
            <th className="sticky top-0 bg-surface-raised px-3 py-2 text-[length:var(--text-xs)] text-text-muted text-right font-medium">در مسیرِ</th>
            <th className="sticky top-0 bg-surface-raised px-3 py-2 text-[length:var(--text-xs)] text-text-muted text-right font-medium">امتیاز</th>
            <th className="sticky top-0 bg-surface-raised px-3 py-2 text-[length:var(--text-xs)] text-text-muted text-right font-medium">فاصله (کیلومتر)</th>
            <th className="sticky top-0 bg-surface-raised px-3 py-2 text-[length:var(--text-xs)] text-text-muted text-right font-medium">عملیات</th>
          </tr>
        </thead>
        <tbody>
          {items.map(({ location: loc, inRun, runIdx, km, assignedTo }, idx) => {
            const avg = averageScore(loc);
            const isSelected = loc.id === selectedMapId;
            return (
              <tr
                key={loc.id ?? `table-${idx}`}
                onClick={() => onSelect(loc.id)}
                className={`border-b border-border/50 cursor-pointer transition-colors hover:bg-surface-raised ${
                  isSelected ? "bg-accent/10" : ""
                } ${priorityHigh ? "border-l-2 border-l-accent" : ""}`}
              >
                <td className="px-3 py-2 text-center font-mono text-[length:var(--text-xs)]">
                  {runIdx != null ? <span className="font-mono">{runIdx}</span> : "+"}
                </td>
                <td className="px-3 py-2 text-[length:var(--text-sm)] text-text font-medium max-w-[200px] truncate">{loc.name}</td>
                <td className="px-3 py-2 text-[length:var(--text-xs)] text-text-muted">
                  {loc.status ? STATUS_LABELS[loc.status] : "بدون وضعیت"}
                </td>
                <td className="max-w-[140px] truncate px-3 py-2 text-[length:var(--text-xs)] text-text-muted">
                  {assignedTo ? assignedTo.driverName ?? "راننده دیگر" : "—"}
                </td>
                <td className="px-3 py-2 text-[length:var(--text-sm)] text-text-muted font-mono">
                  {avg !== null ? faNum(avg) : "—"}
                </td>
                <td className="px-3 py-2 text-[length:var(--text-sm)] text-text-muted font-mono">
                  {km !== null ? faNum(km) : "—"}
                </td>
                <td className="px-3 py-2 text-center flex items-center gap-1 justify-center relative">
                  <DropdownMenu loc={loc} inRun={inRun} runIdx={runIdx} onToggleRun={onToggleRun} onPin={onPin} onTogglePriority={onTogglePriority} />
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onPin(loc.id); }}
                    className="h-6 w-6 rounded border border-border text-text-faint hover:border-accent hover:text-accent flex items-center justify-center text-[length:var(--text-xs)] transition-colors"
                  >
                    <Icon name="map-pin" size="sm" label="پین در نقشه" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onTogglePriority(loc.id); }}
                    aria-label={loc.priority ? "حذف اولویت" : "تعیین اولویت"}
                    aria-pressed={loc.priority}
                    className={`h-6 w-6 rounded border flex items-center justify-center text-[length:var(--text-xs)] transition-colors ${
                      loc.priority
                        ? "border-accent bg-accent text-accent-ink"
                        : "border-border text-text-faint hover:border-accent hover:text-accent"
                    }`}
                  >
                    <Icon name={loc.priority ? "star" : "star-off"} size="sm" filled={loc.priority} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DropdownMenu({ loc, inRun, runIdx, onToggleRun, onPin, onTogglePriority }: { loc: PoolViewItem["location"]; inRun: boolean; runIdx: number | null; onToggleRun: (id: number) => void; onPin: (id: number) => void; onTogglePriority: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block text-right">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="h-6 w-6 rounded border border-border text-text-faint hover:border-accent hover:text-accent flex items-center justify-center text-[length:var(--text-xs)] transition-colors"
      >
        <Icon name="more" size="sm" label="گزینه‌های بیشتر" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 w-48 rounded-[var(--radius-md)] border border-border bg-surface-raised py-1 shadow-[var(--elev-2)]">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggleRun(loc.id); setOpen(false); }}
              disabled={loc.lat === null || loc.lng === null}
              className="block w-full px-3 py-1.5 text-[length:var(--text-sm)] text-right text-text hover:bg-surface disabled:opacity-30"
            >
              <Icon name="package" size="sm" />
              {inRun ? "حذف از مسیر" : "افزودن به مسیر"}
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onPin(loc.id); setOpen(false); }}
              className="block w-full px-3 py-1.5 text-[length:var(--text-sm)] text-right text-text hover:bg-surface"
            >
              <Icon name="edit" size="sm" />
              ویرایش موقعیت
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onTogglePriority(loc.id); setOpen(false); }}
              className="block w-full px-3 py-1.5 text-[length:var(--text-sm)] text-right text-text hover:bg-surface"
            >
              <Icon name="grip-vertical" size="sm" />
              {loc.priority ? "حذف اولویت" : "افزودن اولویت"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
