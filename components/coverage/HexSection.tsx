"use client";

import CollapsibleSection from "@/components/CollapsibleSection";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import { LayerHint } from "@/components/LayersPanel";
import { HEX_RAMP } from "./HexLayer";
import { faNum } from "@/lib/format";
import { HEX_RES_OPTIONS } from "@/lib/h3";
import type { HexMetric } from "@/lib/repo/hexMap";

const METRICS: { id: HexMetric; label: string }[] = [
  { id: "revenue", label: "فروش" },
  { id: "customers", label: "مشتریان" },
  { id: "leads", label: "سرنخ‌ها" },
];
const DAYS = [30, 90, 180];

/** Sidebar controls for the hexagon grid: what each cell counts, its size, and (for sales) how far back. */
export default function HexSection({
  on, onOpenLayers, metric, setMetric, res, setRes, days, setDays, loading, error, cellCount,
}: {
  on: boolean; onOpenLayers: () => void;
  metric: HexMetric; setMetric: (m: HexMetric) => void;
  res: number; setRes: (r: number) => void;
  days: number; setDays: (d: number) => void;
  loading: boolean; error: string | null; cellCount: number;
}) {
  return (
    <CollapsibleSection title="شبکهٔ شش‌ضلعی" icon="grid" storageKey="hex" keywords="شش‌ضلعی هگز فروش منطقه h3 تراکم">
      {!on ? (
        <LayerHint onOpen={onOpenLayers} what="شبکهٔ شش‌ضلعی" />
      ) : (
        <div className="flex flex-col gap-[var(--space-2)]">
          <ChipGroup group={{ id: "hex-metric", label: "هر خانه چه چیزی را نشان دهد", mode: "single", options: METRICS, value: metric, neutral: "__none", onChange: (v) => typeof v === "string" && v && setMetric(v as HexMetric) }} wrap />
          {metric === "revenue" && (
            <ChipGroup group={{ id: "hex-days", label: "بازهٔ فروش", mode: "single", options: DAYS.map((d) => ({ id: String(d), label: `${faNum(d)} روز` })), value: String(days), neutral: "__none", onChange: (v) => typeof v === "string" && v && setDays(Number(v)) }} wrap />
          )}
          <ChipGroup group={{ id: "hex-res", label: "اندازهٔ خانه", mode: "single", options: HEX_RES_OPTIONS.map((r) => ({ id: String(r), label: r === 8 ? "ریز (حدود ۰٫۷ کیلومتر مربع)" : "درشت (حدود ۵ کیلومتر مربع)" })), value: String(res), neutral: "__none", onChange: (v) => typeof v === "string" && v && setRes(Number(v)) }} wrap />
          <div className="flex items-center gap-[var(--space-2)] text-[length:var(--text-xs)] text-text-faint" aria-label="راهنمای رنگ">
            کم
            {HEX_RAMP.map((c) => <span key={c} className="inline-block h-3 w-6 rounded-sm" style={{ background: c }} />)}
            زیاد
          </div>
          <p className="m-0 text-[length:var(--text-xs)] text-text-muted" role="status">
            {error ?? (loading ? "در حال خواندن…" : cellCount === 0 ? "در این بازه داده‌ای برای نمایش نیست." : `${faNum(cellCount)} خانه؛ روی هر خانه بزنید تا عدد دقیقش را ببینید.`)}
          </p>
        </div>
      )}
    </CollapsibleSection>
  );
}
