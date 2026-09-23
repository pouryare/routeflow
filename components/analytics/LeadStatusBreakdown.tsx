"use client";

export default function LeadStatusBreakdown({ byStatus }: { byStatus: Record<string, number> }) {
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0) || 1;
  const colors: Record<string, string> = {
    contacted: "bg-green-500",
    visited: "bg-blue-500",
    no_answer: "bg-red-500",
    declined: "bg-gray-500",
    no_status: "bg-border",
  };
  const labels: Record<string, string> = {
    contacted: "تماس گرفته شد",
    visited: "بازدید شد",
    no_answer: "پاسخ نداد",
    declined: "رد کرد",
    no_status: "بدون وضعیت",
  };

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
      <h2 className="sechead__title mb-3">تقسیم‌بندی بر اساس وضعیت</h2>
      <div className="flex flex-col gap-2">
        {Object.entries(byStatus).map(([status, count]) => (
          <div key={status} className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${colors[status] ?? "bg-border"}`} />
            <span className="text-[length:var(--text-sm)] text-text flex-1">{labels[status] ?? status}</span>
            <span className="text-[length:var(--text-sm)] font-mono text-text-muted">{count}</span>
            <div className="w-24 overflow-hidden rounded bg-border h-1.5">
              <div
                className={`h-full rounded ${colors[status] ?? "bg-border"}`}
                style={{ width: `${(count / total) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
