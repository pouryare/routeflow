import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { catalogueFor } from "@/lib/repo/sessionReads";
import { organizationName } from "@/lib/repo/organizations";
import { priceList } from "@/lib/priceList";
import { isVanRole } from "@/lib/roles";
import { faJalaliDate, tehranTodayIso } from "@/lib/jalali";
import { faNum } from "@/lib/format";
import PrintButton from "@/components/PrintButton";

export const dynamic = "force-dynamic";

/** F23: today's price list as a sheet to print or save as PDF and send to a customer. Prices
 *  are resolved for one date, which is printed on the sheet so an old copy shows its age. */
export default async function PriceListPage() {
  const session = await getSessionFromCookies((await cookies()).get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (isVanRole(session.role)) redirect("/driver");
  const today = tehranTodayIso();
  const { sections, unpriced } = priceList(await catalogueFor(session, { onDate: today }));

  return (
    <main dir="rtl" className="print-report" style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <p style={{ margin: 0 }}>
          {unpriced > 0 ? `${faNum(unpriced)} بسته‌بندی قیمت ندارد و در برگه نیامده است.` : "همهٔ بسته‌بندی‌های فعال در برگه آمده‌اند."}
        </p>
        <PrintButton />
      </div>
      <h1>فهرست قیمت {await organizationName(session.organizationId) ?? ""}</h1>
      <p>قیمت‌های روز {faJalaliDate(today)}. قیمت‌ها به تومان است و ممکن است تغییر کند.</p>
      {sections.length === 0 ? (
        <p>هنوز هیچ کالایی قیمت ندارد.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--border)" }}>
              <th style={{ textAlign: "right" }}>کالا</th>
              <th style={{ textAlign: "right" }}>بسته‌بندی</th>
              <th style={{ textAlign: "left" }}>قیمت</th>
            </tr>
          </thead>
          <tbody>
            {sections.flatMap((s) =>
              s.lines.map((l, i) => (
                <tr key={`${s.product}-${i}`} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td>{i === 0 ? s.product : ""}</td>
                  <td>{l.packaging}<br /><small>{l.contents}</small></td>
                  <td style={{ textAlign: "left" }}>{l.priceLabel}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </main>
  );
}
