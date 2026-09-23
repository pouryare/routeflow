"use client";

import { useRunAfterMount } from "@/lib/useRunAfterMount";
import { useHydrated } from "@/lib/useHydrated";
import { useSession } from "@/lib/useSession";
import { useEffect, useState, useMemo } from "react";
import { averageScore } from "@/lib/leadScore";
import { distanceKm } from "@/lib/geo";
import LeadGeographicDensity from "@/components/analytics/LeadGeographicDensity";
import LeadConversionFunnel from "@/components/analytics/LeadConversionFunnel";
import LeadScoreDistribution from "@/components/analytics/LeadScoreDistribution";
import LeadStatusBreakdown from "@/components/analytics/LeadStatusBreakdown";
import { SkeletonRows } from "@/components/Skeleton";
import EmptyState from "@/components/EmptyState";
import { useToast } from "@/components/ToastProvider";

export default function AnalyticsPage() {
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const { isManager, loading: sessionLoading } = useSession();
  const hydrated = useHydrated();

  async function load() {
    try {
      const res = await fetch("/api/locations");
      const data = await res.json();
      setLocations(data.locations ?? []);
    } catch {
      toast("خطا در بارگذاری آمار", "error");
    } finally {
      setLoading(false);
    }
  }

  useRunAfterMount(load);

  const stats = useMemo(() => {
    const total = locations.length;
    const scored = locations.filter((l) => averageScore(l) !== null).length;
    const avgScore = total > 0 ? locations.reduce((sum, l) => sum + (averageScore(l) ?? 0), 0) / total : 0;
    const byStatus: Record<string, number> = {};
    for (const l of locations) {
      const s = l.status ?? "no_status";
      byStatus[s] = (byStatus[s] ?? 0) + 1;
    }
    const withCoords = locations.filter((l) => l.lat !== null && l.lng !== null).length;
    return { total, scored, avgScore: total > 0 ? avgScore / (scored || 1) : 0, byStatus, withCoords };
  }, [locations]);

  if (loading || sessionLoading) {
    return <div className="pagewrap"><div className="mx-auto max-w-4xl"><SkeletonRows rows={4} /></div></div>;
  }

  return (
    <div dir="rtl" className="pagewrap">
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        <div>
          <div className="font-mono text-[length:var(--text-xs)] uppercase tracking-[0.12em] text-accent">Analytics</div>
          <h1 className="text-[length:var(--text-xl)] font-bold text-text">آمار فهرست مکان‌ها</h1>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "کل مکان‌ها", value: stats.total },
            { label: "امتیاز داده شده", value: `${stats.scored} / ${stats.total}` },
            { label: "میانگین امتیاز", value: stats.total > 0 ? `${(stats.avgScore * 100 / 3).toFixed(0)}%` : "—" },
          ].map((s) => (
            <div key={s.label} className="rounded-[var(--radius-md)] border border-border bg-surface p-4">
              <p className="text-[length:var(--text-xs)] text-text-faint">{s.label}</p>
              <p className="text-[length:var(--text-2xl)] font-bold text-text mt-1">{s.value}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-5">
          <LeadStatusBreakdown byStatus={stats.byStatus} />
          <LeadScoreDistribution locations={locations} />
        </div>

        <LeadConversionFunnel locations={locations} />
        <LeadGeographicDensity locations={locations} />
      </div>
    </div>
  );
}
