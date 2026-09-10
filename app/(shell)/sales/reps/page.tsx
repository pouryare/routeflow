import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { getDb } from "@/lib/db";
import { repsOverview } from "@/lib/repo/repHealth";
import { REP_STAGE_LABEL, type RepStage } from "@/lib/repStages";
import { faNum } from "@/lib/format";
import PageHeader from "@/components/meridian/PageHeader";

export const dynamic = "force-dynamic";

const BAND: Record<string, { label: string; tone: string }> = {
  good: { label: "خوب", tone: "var(--good)" },
  watch: { label: "مراقبت", tone: "var(--warn)" },
  risk: { label: "پرخطر", tone: "var(--crit)" },
};

export default async function RepsPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (!["owner", "group_manager", "rep_manager"].includes(session.role)) redirect("/sales");

  getDb();
  const reps = repsOverview(session.organizationId);

  return (
    <>
    <PageHeader route="/sales/reps" />
    <div className="kblock" dir="rtl">
      <div className="bhead">
        <div>
          <h2>نمایندگان</h2>
          <div className="n">{reps.length === 0 ? "نماینده‌ای ثبت نشده" : `${faNum(reps.length)} نماینده`}</div>
        </div>
      </div>
      <div className="kblock__body overflow-x-auto">
        <table className="w-full border-collapse text-[length:var(--text-sm)]">
          <thead>
            <tr className="text-[var(--text-muted)]">
              <th className="border-b border-[var(--border)] py-2 text-right font-medium">کد / نام</th>
              <th className="border-b border-[var(--border)] py-2 text-left font-medium">مرحله</th>
              <th className="border-b border-[var(--border)] py-2 text-left font-medium">سلامت</th>
              <th className="border-b border-[var(--border)] py-2 text-left font-medium">راه‌اندازی</th>
              <th className="border-b border-[var(--border)] py-2 text-left font-medium">آخرین سفارش</th>
            </tr>
          </thead>
          <tbody>
            {reps.map((r) => (
              <tr key={r.representative_id}>
                <td className="border-b border-[var(--border)] py-2 text-[var(--text)]">
                  <Link href={`/sales/reps/${r.representative_id}`} className="text-[var(--text)] no-underline hover:text-[var(--accent)]">
                    {r.rep_code} · {r.business_name}
                  </Link>
                </td>
                <td className="border-b border-[var(--border)] py-2 text-left text-[var(--text-muted)]">{REP_STAGE_LABEL[r.stage as RepStage] ?? "نامشخص"}</td>
                <td className="border-b border-[var(--border)] py-2 text-left tabular-nums" style={{ color: BAND[r.band].tone }}>
                  {faNum(r.score)} · {BAND[r.band].label}
                </td>
                <td className="border-b border-[var(--border)] py-2 text-left tabular-nums text-[var(--text-muted)]">
                  {faNum(r.onboarding_done)}/{faNum(r.onboarding_total)}
                </td>
                <td className="border-b border-[var(--border)] py-2 text-left tabular-nums text-[var(--text-muted)]">
                  {r.last_order_date ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>    </>
  );
}
