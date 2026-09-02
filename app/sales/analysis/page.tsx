import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { getDb } from "@/lib/db";
import { kpiBoard, newestComputedAt } from "@/lib/repo/kpiSnapshots";
import { actionCenterFor } from "@/lib/repo/actionCenter";
import { customersHealthOverview } from "@/lib/repo/health";
import { currentPeriod, shiftPeriod } from "@/lib/analysis/period";
import { faDateTime, faNum } from "@/lib/format";
import ActionCenter from "@/components/analysis/ActionCenter";
import KpiStrip from "@/components/analysis/KpiStrip";
import MarginTable from "@/components/analysis/MarginTable";

export const dynamic = "force-dynamic";

const BAND_LABEL: Record<string, string> = { good: "خوب", watch: "مراقبت", risk: "پرخطر" };

export default async function AnalysisPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.role === "driver") redirect("/driver");

  getDb();
  const period = currentPeriod();
  const prev = shiftPeriod(period, 1);

  const cards = kpiBoard(session.organizationId, period, prev, session);
  const buckets = actionCenterFor(session);
  const health = customersHealthOverview(session);
  const computedAt = newestComputedAt(session.organizationId, period);

  const isManager = session.role === "owner" || session.role === "group_manager";
  const bandCounts = health.reduce<Record<string, number>>((acc, h) => {
    acc[h.band] = (acc[h.band] ?? 0) + 1;
    return acc;
  }, {});
  const risky = health.filter((h) => h.band === "risk").slice(0, 8);

  return (
    <div className="flex flex-col gap-[var(--space-4)]" dir="rtl">
      <div className="flex items-baseline justify-between">
        <h1 className="text-[length:var(--text-lg)] font-bold text-[var(--text)]">تحلیل</h1>
        <span className="text-[length:var(--text-xs)] text-[var(--text-faint)]">
          {computedAt ? `عددها تا ${faDateTime(computedAt)}` : "هنوز محاسبه نشده — از «به‌روزرسانی تحلیل» استفاده کنید"}
        </span>
      </div>

      <ActionCenter buckets={buckets} />

      <KpiStrip cards={cards} period={period} />

      {isManager && <MarginTable period={period} />}

      <div className="kblock" dir="rtl">
        <div className="bhead">
          <h2>سلامت مشتری</h2>
          <div className="n">
            خوب {faNum(bandCounts.good ?? 0)} · مراقبت {faNum(bandCounts.watch ?? 0)} · پرخطر{" "}
            {faNum(bandCounts.risk ?? 0)}
          </div>
        </div>
        {risky.length === 0 ? (
          <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">مشتری پرخطری نیست.</p>
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
  );
}
