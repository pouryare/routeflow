"use client";

import type { SavedLocationRow } from "@/lib/db";

export default function LeadConversionFunnel({ locations }: { locations: SavedLocationRow[] }) {
  const total = locations.length || 1;
  const stages = [
    { label: "کل مکان‌ها", count: locations.length, color: "bg-accent" },
    { label: "تماس گرفته شده", count: locations.filter((l) => l.status === "contacted").length, color: "bg-green-500" },
    { label: "بازدید شده", count: locations.filter((l) => l.status === "visited").length, color: "bg-blue-500" },
    { label: "تبدیل شده", count: locations.filter((l) => l.status === "visited").length, color: "bg-good" },
  ];

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
      <h2 className="sechead__title mb-3">مسیر تبدیل</h2>
      <div className="flex flex-col gap-2">
        {stages.map((stage) => (
          <div key={stage.label} className="flex items-center gap-2">
            <span className="text-[length:var(--text-sm)] text-text flex-1">{stage.label}</span>
            <div className="w-40 overflow-hidden rounded bg-border h-6 relative">
              <div
                className={`${stage.color} h-full rounded flex items-center justify-end pr-2 transition-all duration-[var(--dur-base)]`}
                style={{ width: `${(stage.count / total) * 100}%` }}
              >
                <span className="text-[length:var(--text-xs)] text-white font-mono">{stage.count}</span>
              </div>
            </div>
            <span className="text-[length:var(--text-xs)] font-mono text-text-faint w-10 text-left">
              {((stage.count / total) * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
