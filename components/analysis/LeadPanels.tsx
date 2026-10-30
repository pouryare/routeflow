"use client";

import { useCallback, useState } from "react";
import type { SavedLocationRow } from "@/lib/db";
import { useRunAfterMount } from "@/lib/useRunAfterMount";
import { leadStats, LEAD_STATUS_LABEL, LEAD_STATUS_TONE, type LeadStats } from "@/lib/leadStats";
import { faNum } from "@/lib/format";
import { SkeletonRows } from "@/components/Skeleton";
import { Icon } from "@/components/meridian/Icon";

/** «سرنخ‌ها» on the sales dashboard: status, funnel and scores of the pinned leads (lib/leadStats).
 *  These came from the retired /analytics page, the only place they existed. The leads come
 *  from /api/locations, which admits PIN_POOL_ROLES, so the dashboard renders this only for
 *  those roles; the gate is at the call site, like CoveragePanels. */
export default function LeadPanels() {
  const [stats, setStats] = useState<LeadStats | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await fetch("/api/locations");
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { locations?: SavedLocationRow[] };
      setStats(leadStats(data.locations ?? []));
    } catch {
      setFailed(true);
    }
  }, []);
  useRunAfterMount(load);

  if (failed) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--text-muted)]">
        آمار سرنخ‌ها خوانده نشد.
        <button type="button" className="inline-flex min-h-11 items-center justify-center gap-[var(--space-2)] btn ghost" onClick={() => void load()}>
          <Icon name="refresh" size="sm" />
          تلاش دوباره
        </button>
      </div>
    );
  }
  if (!stats) return <SkeletonRows rows={4} />;
  if (stats.total === 0) {
    return <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">هنوز سرنخی روی نقشه ثبت نشده است.</p>;
  }

  const statusMax = Math.max(...stats.byStatus.map((s) => s.count), 1);
  const scoreMax = Math.max(...stats.scores.map((s) => s.count), 1);

  return (
    <div className="flex flex-col gap-[var(--space-4)]">
      <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">
        {faNum(stats.total)} سرنخ، {faNum(stats.scored)} امتیازدار
      </p>

      <div className="grid gap-[var(--space-4)] md:grid-cols-2">
        <section>
          <h3 className="sechead__title sechead__title--minor mb-[var(--space-2)]">وضعیت</h3>
          <ul className="m-0 flex list-none flex-col gap-[var(--space-2)] p-0">
            {stats.byStatus.map((s) => (
              <li key={s.key} className="flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)]">
                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: LEAD_STATUS_TONE[s.key] }} />
                <span className="min-w-0 flex-1 text-[var(--text)]">{LEAD_STATUS_LABEL[s.key]}</span>
                <span className="tnum text-[var(--text-muted)]">{faNum(s.count)}</span>
                <span className="h-1.5 w-1/4 overflow-hidden rounded bg-[var(--border)]">
                  <span className="block h-full rounded" style={{ width: `${(s.count / statusMax) * 100}%`, background: LEAD_STATUS_TONE[s.key] }} />
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="sechead__title sechead__title--minor mb-[var(--space-2)]">مسیر پیشرفت</h3>
          <ul className="m-0 flex list-none flex-col gap-[var(--space-2)] p-0">
            {stats.funnel.map((f) => (
              <li key={f.label} className="flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)]">
                <span className="w-28 shrink-0 text-[var(--text)]">{f.label}</span>
                <span className="h-6 min-w-0 flex-1 overflow-hidden rounded bg-[var(--border)]">
                  <span className="block h-full rounded bg-[var(--accent)]" style={{ width: `${(f.count / stats.total) * 100}%` }} />
                </span>
                <span className="tnum w-20 shrink-0 text-start text-[var(--text-muted)]">
                  {faNum(f.count)} · {faNum(f.count / stats.total, { style: "percent" })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section>
        <h3 className="sechead__title sechead__title--minor mb-[var(--space-2)]">امتیاز میانگین</h3>
        {stats.scored === 0 ? (
          <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">هنوز به سرنخی امتیاز داده نشده است.</p>
        ) : (
        <div className="flex h-32 items-end gap-[var(--space-2)]">
          {stats.scores.map((b) => (
            <div key={b.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              <span className="tnum text-[length:var(--text-xs)] text-[var(--text-muted)]">{faNum(b.count)}</span>
              <span className="w-full rounded-t bg-[var(--accent)]" style={{ height: `${(b.count / scoreMax) * 70}%`, minHeight: b.count > 0 ? 4 : 0 }} />
              <span className="text-[length:var(--text-xs)] text-[var(--text-faint)]">{b.label}</span>
            </div>
          ))}
        </div>
        )}
      </section>
    </div>
  );
}
