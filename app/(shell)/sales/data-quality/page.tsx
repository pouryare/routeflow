import CardTable from "@/components/CardTable";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import { dataQuality, type Gap } from "@/lib/repo/dataQuality";
import PageHeader from "@/components/meridian/PageHeader";
import { faNum } from "@/lib/format";

export const dynamic = "force-dynamic";

const GAP_LABEL: Record<Gap, string> = { location: "بدون مکان", phone: "بدون تلفن", district: "بدون منطقه" };

/** F54: customers missing a location, phone or district (lib/repo/dataQuality.ts), with counts
 *  per group. Each row opens the customer's page, where the record is fixed. Managers see their
 *  own group; the owner sees the company. */
export default async function DataQualityPage() {
  const jar = await cookies();
  const session = await getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (!MANAGE_ROLES.includes(session.role)) redirect("/sales");

  const { groups, rows, total } = await dataQuality(session);

  return (
    <>
      <PageHeader route="/sales/data-quality" />
      <div className="flex flex-col gap-[var(--space-4)]" dir="rtl">
        <section className="kblock">
          <div className="bhead">
            <h2>به تفکیک گروه</h2>
            <div className="n">{faNum(total)} مشتری ناقص</div>
          </div>
          <div className="kblock__body">
            {groups.length === 0 ? (
              <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">هنوز مشتری فعالی ثبت نشده.</p>
            ) : (
              <CardTable className="w-full border-collapse text-[length:var(--text-sm)]">
                <thead>
                  <tr className="border-b border-border text-right text-text-muted">
                    <th className="py-1 font-normal">گروه</th>
                    <th className="py-1 font-normal">مشتری</th>
                    <th className="py-1 font-normal">بدون مکان</th>
                    <th className="py-1 font-normal">بدون تلفن</th>
                    <th className="py-1 font-normal">بدون منطقه</th>
                    <th className="py-1 font-normal">کامل</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.group_name ?? "none"} className="border-b border-border">
                      <td className="py-1">{g.group_name ?? "بدون گروه"}</td>
                      <td className="py-1 tabular-nums">{faNum(g.customers)}</td>
                      <td className="py-1 tabular-nums">{faNum(g.location)}</td>
                      <td className="py-1 tabular-nums">{faNum(g.phone)}</td>
                      <td className="py-1 tabular-nums">{faNum(g.district)}</td>
                      <td className="py-1 tabular-nums">{faNum(Math.round(g.complete * 100))}٪</td>
                    </tr>
                  ))}
                </tbody>
              </CardTable>
            )}
          </div>
        </section>

        <section className="kblock">
          <div className="bhead">
            <h2>مشتریان ناقص</h2>
            {total > rows.length && <div className="n">{faNum(rows.length)} از {faNum(total)}</div>}
          </div>
          <div className="kblock__body">
            {rows.length === 0 ? (
              <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">همهٔ مشتریان مکان، تلفن و منطقه دارند.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-[var(--space-2)] p-0">
                {rows.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/crm/${r.id}`}
                      className="touch flex flex-wrap items-center justify-between gap-[var(--space-2)] rounded-[var(--radius-md)] border border-border px-[var(--space-3)] py-[var(--space-2)] hover:border-accent"
                    >
                      <span>
                        <span className="block text-text">{r.business_name}</span>
                        <span className="text-[length:var(--text-xs)] text-text-muted">
                          {r.group_name ?? "بدون گروه"}
                        </span>
                      </span>
                      <span className="flex flex-wrap gap-1">
                        {r.gaps.map((g) => (
                          <span key={g} className="rounded-[var(--radius-sm)] border border-warn px-2 text-[length:var(--text-xs)] text-warn">
                            {GAP_LABEL[g]}
                          </span>
                        ))}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
