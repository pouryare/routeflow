import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { getDb } from "@/lib/db";
import { listDeliveries, type DeliveryStatus } from "@/lib/repo/deliveries";
import { faNum } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import PageHeader from "@/components/meridian/PageHeader";

export const dynamic = "force-dynamic";

const D_LABEL: Record<DeliveryStatus, string> = {
  PLANNED: "برنامه‌ریزی‌شده",
  ASSIGNED: "تخصیص‌یافته",
  LOADED: "بارگیری‌شده",
  IN_TRANSIT: "در مسیر",
  DELIVERED: "تحویل‌شده",
  PARTIAL: "تحویل ناقص",
  FAILED: "ناموفق",
  RETURNED: "مرجوعی",
  CANCELLED: "لغوشده",
};

export default async function DeliveriesPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.role !== "owner" && session.role !== "group_manager") redirect("/sales");

  getDb();
  const rows = listDeliveries(session.organizationId).slice(0, 200);

  return (
    <>
    <PageHeader route="/sales/deliveries" />
    <div className="kblock">
      <div className="bhead">
        <div>
          <h2>تحویل‌ها</h2>
          <div className="n">
            {rows.length === 0 ? "تحویلی ثبت نشده" : `${faNum(rows.length)} تحویل`}
          </div>
        </div>
      </div>

      <div className="kblock__body overflow-x-auto">
        <table className="w-full border-collapse text-[length:var(--text-sm)]">
          <thead>
            <tr className="text-[var(--text-muted)]">
              <th className="border-b border-[var(--border)] py-2 text-right font-medium">سفارش</th>
              <th className="border-b border-[var(--border)] py-2 text-left font-medium">تلاش</th>
              <th className="border-b border-[var(--border)] py-2 text-left font-medium">وضعیت</th>
              <th className="border-b border-[var(--border)] py-2 text-left font-medium">تاریخ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td className="border-b border-[var(--border)] py-2 text-[var(--text)]">
                  <Link
                    href={`/sales/orders/${d.order_id}`}
                    className="text-[var(--text)] no-underline hover:text-[var(--accent)]"
                  >
                    {d.order_no}
                  </Link>
                </td>
                <td className="border-b border-[var(--border)] py-2 text-left tabular-nums text-[var(--text-muted)]">
                  {faNum(d.seq)}
                </td>
                <td className="border-b border-[var(--border)] py-2 text-left text-[var(--text-muted)]">
                  {D_LABEL[d.status] ?? d.status}
                </td>
                <td className="border-b border-[var(--border)] py-2 text-left tabular-nums text-[var(--text-muted)]">
                  {d.completed_at ? faJalaliDate(d.completed_at) : d.planned_date ? faJalaliDate(d.planned_date) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>    </>
  );
}
