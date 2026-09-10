import RepDefinitions from "@/components/sales/RepDefinitions";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { getDb } from "@/lib/db";
import { repsOverview, REP_HEALTH_BAND_FA } from "@/lib/repo/repHealth";
import { faJalaliDate } from "@/lib/jalali";
import { REP_STAGE_LABEL, type RepStage } from "@/lib/repStages";
import { faNum } from "@/lib/format";
import PageHeader from "@/components/meridian/PageHeader";

export const dynamic = "force-dynamic";

/* Labels from REP_HEALTH_BAND_FA, the one map (this page's own copy said «مراقبت» where
   the rep's page said «نیازمند پیگیری»); only the tone is this table's business. */
const BAND_TONE: Record<string, string> = { good: "var(--good)", watch: "var(--warn)", risk: "var(--crit)" };

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Representatives, in two modes (item 25): «عملکرد», how each rep is doing, and
 *  «تعریف و راه‌اندازی», defining a rep and walking them through onboarding. The second
 *  was its own page at /sales/admin/representatives; it is shown here to the roles its
 *  API admits (owner, rep_manager). The mode lives in the URL, like the journey page's. */
export default async function RepsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (!["owner", "group_manager", "rep_manager"].includes(session.role)) redirect("/sales");

  getDb();
  const canDefine = session.role === "owner" || session.role === "rep_manager";
  const mode = canDefine && one((await searchParams).view) === "define" ? "define" : "perform";
  const reps = repsOverview(session.organizationId);

  return (
    <>
    <PageHeader route="/sales/reps" />
    {canDefine ? (
      <nav className="jmode" aria-label="نمای نمایندگان" style={{ marginBottom: 14 }}>
        <Link className={`btn ${mode === "perform" ? "solid" : "ghost"}`} aria-current={mode === "perform" ? "page" : undefined} href="/sales/reps">
          عملکرد
        </Link>
        <Link className={`btn ${mode === "define" ? "solid" : "ghost"}`} aria-current={mode === "define" ? "page" : undefined} href="/sales/reps?view=define">
          تعریف و راه‌اندازی
        </Link>
      </nav>
    ) : null}
    {mode === "define" ? (
      <RepDefinitions />
    ) : (
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
                <td className="border-b border-[var(--border)] py-2 text-left tabular-nums" style={{ color: BAND_TONE[r.band] }}>
                  {faNum(r.score)} · {REP_HEALTH_BAND_FA[r.band as keyof typeof REP_HEALTH_BAND_FA] ?? "نامشخص"}
                </td>
                <td className="border-b border-[var(--border)] py-2 text-left tabular-nums text-[var(--text-muted)]">
                  {faNum(r.onboarding_done)}/{faNum(r.onboarding_total)}
                </td>
                <td className="border-b border-[var(--border)] py-2 text-left tabular-nums text-[var(--text-muted)]">
                  {r.last_order_date ? faJalaliDate(r.last_order_date) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
    )}
    </>
  );
}
