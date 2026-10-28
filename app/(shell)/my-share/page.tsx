import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import PageHeader from "@/components/meridian/PageHeader";
import SectionHead from "@/components/meridian/SectionHead";
import EmptyState from "@/components/EmptyState";
import AcctTable, { CELL, NUM } from "@/components/accounting/AcctTable";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { homePathFor, isShareholder } from "@/lib/roles";
import { myShareOf, shareholderOfUserIn } from "@/lib/repo/routeAdapters";
import { faJalaliDate, todayJalali } from "@/lib/jalali";
import { faNum, faToman } from "@/lib/format";

export const dynamic = "force-dynamic";

/** A shareholder's own page: their share, capital, advances and what they are owed, and nothing about the company
 *  or anyone else. Only the shareholder role opens it, and every figure is read for the one shareholder row linked
 *  to the signed-in account (proxy.ts keeps the role on this page; this is the authoritative check). */
export default async function MySharePage() {
  const jar = await cookies();
  const session = await getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (!isShareholder(session.role)) redirect(homePathFor(session.role));

  const me = await shareholderOfUserIn(session.organizationId, session.user.id);
  const data = me ? await myShareOf(session.organizationId, me.id, todayJalali().jy) : null;

  return (
    <>
      <PageHeader route="/my-share" />
      {!data ? (
        <EmptyState icon="users" title="حساب شما هنوز به یک شریک وصل نشده" hint="از مدیر شرکت بخواهید حساب شما را در صفحهٔ «شرکا» به نام شما وصل کند." />
      ) : (
        <>
          <SectionHead title={data.name} sub={data.legalForm === "registered" ? "شرکت ثبت‌شده" : "مشارکت مدنی"} />
          <AcctTable head={["سهم شما", "درصد"]}>
            {data.shares.length === 0 ? (
              <tr className="border-t border-border"><td className={CELL}>سهمی برای شما ثبت نشده</td><td className={NUM}>—</td></tr>
            ) : (
              data.shares.map((s) => (
                <tr key={s.scope} className="border-t border-border">
                  <td className={CELL}>{s.scope}</td>
                  <td className={NUM}>{faNum(s.percentBp / 100, { maximumFractionDigits: 2 })}٪</td>
                </tr>
              ))
            )}
          </AcctTable>

          <SectionHead title="حساب شما" />
          <AcctTable head={["", "مبلغ"]}>
            <tr className="border-t border-border"><td className={CELL}>سرمایهٔ ثبت‌شده</td><td className={NUM}>{faToman(data.capitalToman)}</td></tr>
            <tr className="border-t border-border"><td className={CELL}>علی‌الحساب برداشته‌شده</td><td className={NUM}>{faToman(data.advancesToman)}</td></tr>
            <tr className="border-t border-border"><td className={CELL}>سود تقسیم‌شدهٔ پرداخت‌نشده</td><td className={NUM}>{faToman(data.dividendsOwedToman)}</td></tr>
            {data.estimate && (
              <tr className="border-t border-border"><td className={CELL}>برآورد سهم سال {faNum(data.estimate.year, { useGrouping: false })} (ثبت‌نشده)</td><td className={NUM}>{faToman(data.estimate.amountToman)}</td></tr>
            )}
          </AcctTable>

          {data.history.length > 0 && (
            <>
              <SectionHead title="سودهای تقسیم‌شده" />
              <AcctTable head={["سال", "سهم شما"]}>
                {data.history.map((h) => (
                  <tr key={h.year} className="border-t border-border"><td className={CELL}>{faNum(h.year, { useGrouping: false })}</td><td className={NUM}>{faToman(h.amountToman)}</td></tr>
                ))}
              </AcctTable>
            </>
          )}
          {data.payouts.length > 0 && (
            <>
              <SectionHead title="پرداخت‌های سود به شما" />
              <AcctTable head={["تاریخ", "مبلغ"]}>
                {data.payouts.map((p, i) => (
                  <tr key={i} className="border-t border-border"><td className={CELL}>{faJalaliDate(p.paidOn)}</td><td className={NUM}>{faToman(p.amountToman)}</td></tr>
                ))}
              </AcctTable>
            </>
          )}
        </>
      )}
    </>
  );
}
