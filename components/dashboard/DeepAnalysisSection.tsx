import type { Session } from "@/lib/session";
import { yieldToEventLoop } from "@/lib/yieldToEventLoop";
import { REP_HEALTH_BAND_FA } from "@/lib/repo/repHealth";
import { faNum } from "@/lib/format";
import { faJalaliDateTime } from "@/lib/jalali";
import { kpiBoard, kpiHistory, newestComputedAt } from "@/lib/repo/kpiSnapshots";
import { actionCenterFor } from "@/lib/repo/actionCenter";
import { customersHealthOverview } from "@/lib/repo/health";
import { currentPeriod, shiftPeriod } from "@/lib/analysis/period";
import { MANAGE_ROLES } from "@/lib/roles";
import ActionCenter from "@/components/analysis/ActionCenter";
import KpiStrip from "@/components/analysis/KpiStrip";
import MarginTable from "@/components/analysis/MarginTable";
import SweepButton from "@/components/SweepButton";

const BAND_LABEL = REP_HEALTH_BAND_FA as Record<string, string>;

/** «تحلیل عمیق» -- the snapshot KPIs, the action centre, margins and customer health.
 *
 *  Its own component behind a Suspense boundary: the action centre and the health overview
 *  are the slowest reads on the dashboard after the money section, and nothing above them
 *  depends on either. Reading them in the page would hold the whole route back. */

export default async function DeepAnalysisSection({ session }: { session: Session }) {
  await yieldToEventLoop();
  // ── تحلیل عمیق — the former /sales/analysis page, folded in below the KPI tiles.
  const aPeriod = currentPeriod();
  const aPrev = shiftPeriod(aPeriod, 1);
  const kpiCards = await kpiBoard(session.organizationId, aPeriod, aPrev, session);
  /* Six periods of every metric for the KPI bar's sparklines, oldest first (item 10). */
  const kpiTrends = await kpiHistory(
    session.organizationId,
    [5, 4, 3, 2, 1, 0].map((n) => shiftPeriod(aPeriod, n)),
    session,
  );
  const buckets = await actionCenterFor(session);
  const health = await customersHealthOverview(session);
  const kpiComputedAt = await newestComputedAt(session.organizationId, aPeriod);
  const isManager = MANAGE_ROLES.includes(session.role);
  const bandCounts = health.reduce<Record<string, number>>((acc, h) => {
    acc[h.band] = (acc[h.band] ?? 0) + 1;
    return acc;
  }, {});
  const risky = health.filter((h) => h.band === "risk").slice(0, 8);

  return (
    <>
      {/* ── تحلیل عمیق — snapshot KPIs, the action centre, margins and customer health.
          Was its own /sales/analysis tab; it reads the same figures against the same
          period and belongs next to the dashboard it was always compared with. */}
      <section className="flex flex-col gap-[var(--space-4)]">
        <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)]">
          <h2
            className="sechead__title"
            style={{ fontFamily: "var(--font-display)" }}
          >
            تحلیل عمیق
          </h2>
          <div className="flex items-center gap-[var(--space-2)]">
            <span className="text-[length:var(--text-xs)] text-[var(--text-faint)]">
              {kpiComputedAt ? `عددها تا ${faJalaliDateTime(kpiComputedAt)}` : "هنوز محاسبه نشده"}
            </span>
            {isManager && (
              <SweepButton endpoint="/api/analysis/refresh" idleLabel="به‌روزرسانی تحلیل" />
            )}
          </div>
        </div>

        <ActionCenter buckets={buckets} />
        <KpiStrip cards={kpiCards} period={aPeriod} trends={kpiTrends} />
        {isManager && <MarginTable period={aPeriod} />}

        <div className="kblock" dir="rtl">
          <div className="bhead">
            <h2>سلامت مشتری</h2>
            <div className="n">
              خوب {faNum(bandCounts.good ?? 0)} · مراقبت {faNum(bandCounts.watch ?? 0)} · پرخطر{" "}
              {faNum(bandCounts.risk ?? 0)}
            </div>
          </div>
          <div className="kblock__body">
            {risky.length === 0 ? (
              <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">مشتری پرخطری ندارید.</p>
            ) : (
              <ul className="m-0 list-none p-0 text-[length:var(--text-sm)]">
                {risky.map((h) => (
                  <li
                    key={h.customer_id}
                    className="flex items-center justify-between border-b border-[var(--border)] py-[var(--space-1)]"
                  >
                    <span className="text-[var(--text)]">{h.business_name}</span>
                    <span className="tabular-nums text-[var(--text-muted)]">
                      {faNum(h.score)} · {BAND_LABEL[h.band]} · {h.reasons[0] ?? ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
