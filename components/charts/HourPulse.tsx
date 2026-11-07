"use client";

import { useState } from "react";
import { faNum } from "@/lib/format";
import { busiestHour } from "@/lib/hourBuckets";

/** The day's pulse: 24 bars, one per hour, for the last 30 days of orders. Touch or drag along the bars and
 *  the line above says which hour it is and how many orders it had; at rest it names the busiest hour.
 *  Bars read right to left like the rest of the page (the first hour is at the right edge). */
export default function HourPulse({ counts }: { counts: number[] }) {
  const [pick, setPick] = useState<number | null>(null);
  const max = Math.max(1, ...counts);
  const best = busiestHour(counts);
  const shown = pick ?? best;
  const at = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    // RTL: the right edge is hour 0.
    const x = Math.min(Math.max((r.right - e.clientX) / r.width, 0), 0.9999);
    setPick(Math.floor(x * 24));
  };
  return (
    <figure className="card m-0 p-[var(--space-4)]">
      <figcaption>
        <h3 className="sechead__title m-0">ساعت‌های شلوغ</h3>
        <p className="m-0 mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--muted)]" aria-live="polite">
          {shown === null
            ? "هنوز سفارشی در ۳۰ روز گذشته ثبت نشده است"
            : `${faNum(shown)} تا ${faNum(shown + 1)} · ${faNum(counts[shown])} سفارش${pick === null ? " (شلوغ‌ترین ساعت)" : ""}`}
        </p>
      </figcaption>
      <div
        className="mt-[var(--space-3)] flex h-24 items-end gap-[2px]"
        style={{ touchAction: "pan-y" }}
        onPointerDown={at}
        onPointerMove={(e) => e.buttons > 0 && at(e)}
        onPointerLeave={() => setPick(null)}
        role="img"
        aria-label="سفارش‌ها به تفکیک ساعت روز"
      >
        {counts.map((n, h) => (
          <span
            key={h}
            className="block flex-1 rounded-t-[3px]"
            style={{
              height: `${Math.max(4, (n / max) * 100)}%`,
              background: h === shown ? "var(--accent)" : "var(--border-strong)",
              transition: "background 120ms",
            }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[length:var(--text-xs)] tabular-nums text-[var(--text-faint)]" aria-hidden="true">
        <span>{faNum(0)}</span>
        <span>{faNum(6)}</span>
        <span>{faNum(12)}</span>
        <span>{faNum(18)}</span>
        <span>{faNum(23)}</span>
      </div>
    </figure>
  );
}
