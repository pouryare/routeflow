import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { getDb } from "@/lib/db";
import { demandBoard, newestForecastAt } from "@/lib/repo/forecast";
import { churnBoard } from "@/lib/repo/churn";
import { resolvedCapacityFactorsFor, learnedCapacityCounts } from "@/lib/repo/capacityLearning";
import { faDateTime } from "@/lib/format";
import DemandTable from "@/components/predict/DemandTable";
import ChurnList from "@/components/predict/ChurnList";
import LearnedCapacity from "@/components/predict/LearnedCapacity";
import SweepButton from "@/components/SweepButton";

export const dynamic = "force-dynamic";

export default async function ForecastPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.role !== "owner" && session.role !== "group_manager") redirect("/sales");

  getDb();
  const org = session.organizationId;

  const entries = demandBoard(org);
  const churn = churnBoard(org);
  const factors = resolvedCapacityFactorsFor(org);
  const learnedN = learnedCapacityCounts(org);
  const capacityRows = factors.map((f) => ({ ...f, learned_n: learnedN.get(f.condition_code) ?? 0 }));
  const computedAt = newestForecastAt(org);

  return (
    <div className="flex flex-col gap-[var(--space-4)]" dir="rtl">
      <div className="flex items-baseline justify-between">
        <h1 className="text-[length:var(--text-lg)] font-bold text-[var(--text)]">پیش‌بینی</h1>
        <div className="flex items-center gap-[var(--space-2)]">
          <span className="text-[length:var(--text-xs)] text-[var(--text-faint)]">
            {computedAt ? `عددها تا ${faDateTime(computedAt)}` : "هنوز محاسبه نشده"}
          </span>
          <SweepButton endpoint="/api/predict/refresh" idleLabel="به‌روزرسانی پیش‌بینی" />
        </div>
      </div>

      <DemandTable entries={entries} />
      <ChurnList rows={churn} />
      <LearnedCapacity rows={capacityRows} />
    </div>
  );
}
