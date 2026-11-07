import CardTable from "@/components/CardTable";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import { leadSourceReport, topReferrers, REVENUE_WINDOW_DAYS } from "@/lib/repo/leadSources";
import CustomerName from "@/components/CustomerName";
import PageHeader from "@/components/meridian/PageHeader";
import { faNum } from "@/lib/format";

export const dynamic = "force-dynamic";

/** F137: leads, customers and early revenue per lead source (lib/repo/leadSources.ts). A manager
 *  sees their group, the owner the company. Spend per source is not recorded yet. */
export default async function LeadSourcesPage() {
  const jar = await cookies();
  const session = await getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (!MANAGE_ROLES.includes(session.role)) redirect("/sales");

  const rows = await leadSourceReport(session);
  const referrers = await topReferrers(session);
  const totals = rows.reduce((t, r) => ({ leads: t.leads + r.leads, converted: t.converted + r.converted }), { leads: 0, converted: 0 });

  return (
    <>
      <PageHeader route="/sales/lead-sources" />
      <section className="kblock" dir="rtl">
        <div className="bhead">
          <h2>به تفکیک منبع</h2>
          <div className="n">
            {faNum(totals.leads)} سرنخ · {faNum(totals.converted)} مشتری
          </div>
        </div>
        <div className="kblock__body">
          {rows.length === 0 ? (
            <p className="text-[length:var(--text-sm)] text-[var(--muted)]">هنوز سرنخی ثبت نشده.</p>
          ) : (
            <>
              <div style={{ overflowX: "auto" }}>
                <CardTable className="w-full border-collapse text-[length:var(--text-sm)]">
                  <thead>
                    <tr className="border-b border-border text-right text-text-muted">
                      <th className="py-1 font-normal">منبع</th>
                      <th className="py-1 font-normal">سرنخ</th>
                      <th className="py-1 font-normal">مشتری شد</th>
                      <th className="py-1 font-normal">نرخ تبدیل</th>
                      <th className="py-1 font-normal">خرید {faNum(REVENUE_WINDOW_DAYS)} روز اول (تومان)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.source ?? "none"} className="border-b border-border">
                        <td className={`py-1 ${r.source ? "text-text" : "text-warn"}`}>{r.label}</td>
                        <td className="py-1 tabular-nums">{faNum(r.leads)}</td>
                        <td className="py-1 tabular-nums">{faNum(r.converted)}</td>
                        <td className="py-1 tabular-nums">{faNum(Math.round(r.rate * 100))}٪</td>
                        <td className="py-1 tabular-nums">{faNum(r.revenue90)}</td>
                      </tr>
                    ))}
                  </tbody>
                </CardTable>
              </div>
              <p className="mt-2 text-[length:var(--text-xs)] text-text-faint">
                «مشتری شد» یعنی دست‌کم یک سفارش تحویل‌شده دارد. هزینهٔ هر منبع هنوز ثبت نمی‌شود، پس بازده هزینه اینجا نیست.
              </p>
            </>
          )}
        </div>
      </section>
      <section className="kblock" dir="rtl">
        <div className="bhead">
          <h2>بیشترین معرفی‌ها</h2>
        </div>
        <div className="kblock__body">
          {referrers.length === 0 ? (
            <p className="text-[length:var(--text-sm)] text-[var(--muted)]">هنوز کسی مشتری تازه‌ای معرفی نکرده. معرف را هنگام ثبت سرنخ انتخاب کنید.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-[var(--space-2)] p-0 text-[length:var(--text-sm)]">
              {referrers.map((r) => (
                <li key={r.id} className="flex items-baseline justify-between gap-[var(--space-2)] border-b border-border pb-[var(--space-2)]">
                  <CustomerName id={r.id} name={r.name} />
                  <span className="tabular-nums text-text-muted">
                    {faNum(r.referred)} معرفی · {faNum(r.converted)} مشتری شد
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
