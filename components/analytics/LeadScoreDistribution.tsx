"use client";

import { averageScore } from "@/lib/leadScore";

export default function LeadScoreDistribution({ locations }: { locations: any[] }) {
  const buckets = [
    { label: "۰–۱", min: 0, max: 1 },
    { label: "۱–۲", min: 1, max: 2 },
    { label: "۲–۳", min: 2, max: 3 },
    { label: "۳–۴", min: 3, max: 4 },
    { label: "۴+", min: 4, max: Infinity },
  ];

  const counts = buckets.map((b) => ({
    ...b,
    count: locations.filter((l) => {
      const s = averageScore(l);
      return s !== null && s >= b.min && s < b.max;
    }).length,
  }));

  const maxCount = Math.max(...counts.map((c) => c.count), 1);

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
      <h2 className="sechead__title mb-3">توزیع امتیازات</h2>
      <div className="flex items-end gap-2 h-32">
        {counts.map((b) => (
          <div key={b.label} className="flex flex-col items-center gap-1 flex-1">
            <span className="text-[length:var(--text-xs)] font-mono text-text-muted">{b.count}</span>
            <div
              className="w-full rounded-t bg-accent transition-all duration-[var(--dur-base)]"
              style={{ height: `${(b.count / maxCount) * 100}%`, minHeight: b.count > 0 ? "4px" : "0" }}
            />
            <span className="text-[length:var(--text-xs)] text-text-faint">{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
