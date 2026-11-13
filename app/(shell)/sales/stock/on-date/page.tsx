import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { MANAGE_ROLES, isOwner } from "@/lib/roles";
import PageHeader from "@/components/meridian/PageHeader";
import SectionHead from "@/components/meridian/SectionHead";
import AcctTable, { CELL, NUM } from "@/components/accounting/AcctTable";
import StockDatePicker from "@/components/sales/StockDatePicker";
import { stockOnDate } from "@/lib/repo/stockOnDate";
import { faNum } from "@/lib/format";
import { faJalaliDate, tehranTodayIso } from "@/lib/jalali";
import { pageMetadata } from "@/lib/pageMeta";

export const metadata = pageMetadata("/sales/stock/on-date");

export const dynamic = "force-dynamic";

/** D9: what was on the shelves at the end of a past day. */
export default async function StockOnDatePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const jar = await cookies();
  const session = await getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (!MANAGE_ROLES.includes(session.role)) redirect("/sales");
  const { date } = await searchParams;
  const today = tehranTodayIso();
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today ? date : today;
  const rows = await stockOnDate(session.organizationId, day);
  const seeValue = isOwner(session.role);
  const total = rows.reduce((s, r) => s + r.valueToman, 0);
  return (
    <>
      <PageHeader route="/sales/stock/on-date" />
      <SectionHead title="موجودی در یک روز" sub={`پایان روز ${faJalaliDate(day)}`} />
      <StockDatePicker value={day} />
      {rows.length === 0 ? (
        <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">در این روز موجودی ثبت نشده است.</p>
      ) : (
        <AcctTable
          head={seeValue ? ["کالا", "تعداد", "ارزش"] : ["کالا", "تعداد"]}
          foot={seeValue ? <tr className="bg-surface"><td className={CELL}>جمع</td><td className={NUM} /><td className={NUM}>{faNum(total)}</td></tr> : undefined}
        >
          {rows.map((r) => (
            <tr key={r.productId} className="border-t border-border">
              <td className={CELL}>{r.name}</td>
              <td className={NUM}>{faNum(r.qty)} {r.baseUnit}</td>
              {seeValue ? <td className={NUM}>{faNum(r.valueToman)}</td> : null}
            </tr>
          ))}
        </AcctTable>
      )}
      {seeValue ? <p className="mt-2 text-[length:var(--text-xs)] text-[var(--muted)]">ارزش با میانگین بهای امروز حساب شده، چون بهای روزهای گذشته ذخیره نمی‌شود.</p> : null}
    </>
  );
}
