"use client";

import { useState } from "react";
import WhyDrilldown, { type Rung } from "./WhyDrilldown";

export interface KpiCard {
  metric: string;
  title_fa: string;
  value: number | null;
  prev_value: number | null;
  target: number | null;
  direction: "up" | "down";
  definition_fa: string;
  action_fa: string;
  delta_pct: number;
  on_track: boolean;
  sample_size: number | null;
}

const RATIO = new Set([
  "gross_margin",
  "repeat_rate",
  "collection_rate",
  "on_time_delivery",
  "fulfillment_rate",
  "sample_conversion",
]);
const WHYABLE = new Set(["net_sales", "gross_profit", "orders"]);

function show(metric: string, v: number | null): string {
  if (v === null) return "—";
  if (RATIO.has(metric)) return `${Math.round(v * 100).toLocaleString("fa-IR")}٪`;
  return Math.round(v).toLocaleString("fa-IR");
}
const deltaLabel = (n: number) =>
  `${n >= 0 ? "+" : ""}${Math.round(n * 100).toLocaleString("fa-IR")}٪`;

export default function KpiStrip({ cards, period }: { cards: KpiCard[]; period: string }) {
  const [openInfo, setOpenInfo] = useState<string | null>(null);
  const [why, setWhy] = useState<Record<string, Rung[] | "loading">>({});

  async function loadWhy(metric: string) {
    if (why[metric]) {
      setWhy((w) => {
        const n = { ...w };
        delete n[metric];
        return n;
      });
      return;
    }
    setWhy((w) => ({ ...w, [metric]: "loading" }));
    const res = await fetch(`/api/analysis/why?metric=${metric}&to=${period}`);
    const j = await res.json();
    setWhy((w) => ({ ...w, [metric]: j.ok ? (j.chain as Rung[]) : [] }));
  }

  return (
    <div className="kblock" dir="rtl">
      <div className="bhead">
        <h2>شاخص‌های کلیدی</h2>
      </div>
      <div className="grid grid-cols-2 gap-[var(--space-2)] sm:grid-cols-3 lg:grid-cols-4">
        {cards.map((c) => {
          const tone = c.value === null ? "var(--text-faint)" : c.on_track ? "var(--good)" : "var(--crit)";
          return (
            <div
              key={c.metric}
              className="flex flex-col rounded-[var(--radius-sm)] border border-[var(--border)] p-[var(--space-2)]"
            >
              <div className="flex items-center justify-between">
                <span className="text-[length:var(--text-xs)] text-[var(--text-muted)]">{c.title_fa}</span>
                <button
                  type="button"
                  onClick={() => setOpenInfo((m) => (m === c.metric ? null : c.metric))}
                  className="cursor-pointer border-0 bg-transparent text-[length:var(--text-xs)] text-[var(--text-faint)]"
                  aria-label="تعریف"
                >
                  ⓘ
                </button>
              </div>
              <span className="text-[length:var(--text-lg)] font-bold tabular-nums" style={{ color: tone }}>
                {show(c.metric, c.value)}
              </span>
              <div className="flex items-center gap-[var(--space-1)] text-[length:var(--text-xs)] tabular-nums text-[var(--text-muted)]">
                {c.prev_value !== null && (
                  <span style={{ color: c.delta_pct >= 0 ? "var(--good)" : "var(--crit)" }}>
                    {deltaLabel(c.delta_pct)}
                  </span>
                )}
                {c.target !== null && <span>هدف {Math.round(c.target).toLocaleString("fa-IR")}</span>}
                {c.sample_size !== null && c.sample_size < 5 && (
                  <span className="text-[var(--text-faint)]">نمونهٔ کم</span>
                )}
              </div>

              {openInfo === c.metric && (
                <div className="mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
                  <div>{c.definition_fa}</div>
                  <div className="mt-[var(--space-1)] text-[var(--text-faint)]">{c.action_fa}</div>
                </div>
              )}

              {WHYABLE.has(c.metric) && (
                <button
                  type="button"
                  onClick={() => loadWhy(c.metric)}
                  className="mt-[var(--space-1)] cursor-pointer self-start border-0 bg-transparent p-0 text-[length:var(--text-xs)] text-[var(--accent)]"
                >
                  چرا؟
                </button>
              )}
              {why[c.metric] === "loading" && (
                <div className="text-[length:var(--text-xs)] text-[var(--text-faint)]">در حال محاسبه…</div>
              )}
              {Array.isArray(why[c.metric]) && <WhyDrilldown chain={why[c.metric] as Rung[]} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
