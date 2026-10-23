import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { runForNotes } from "@/lib/repo/driverStops";
import { runNotes } from "@/lib/runNotes";
import PrintButton from "@/components/PrintButton";
import { faNum } from "@/lib/format";

export const dynamic = "force-dynamic";

/** F101: every delivery note of one run, in stop order, one per printed page, after a cover sheet.
 *  For the manager who loads the van and for the run's driver. Printed from the browser (A4 or a
 *  roll), so the layout is plain HTML with page breaks rather than the thermal canvas. */
export default async function RunNotesPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromCookies((await cookies()).get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  const id = Number((await params).id);
  const found = Number.isInteger(id) ? await runForNotes(session, id) : null;
  if (!found) notFound();
  const { cover, notes } = runNotes(found.run, found.businessName, found.vehicle);

  return (
    <main dir="rtl" className="print-report run-notes" style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <p style={{ margin: 0 }}>{faNum(notes.length)} برگهٔ تحویل، به ترتیب توقف‌ها</p>
        <PrintButton />
      </div>

      <section className="run-notes__page">
        <h1>برگهٔ سفر تحویل</h1>
        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 16px" }}>
          <dt>تاریخ</dt><dd>{cover.dateLabel}</dd>
          <dt>راننده</dt><dd>{cover.driverName}</dd>
          <dt>خودرو</dt><dd>{cover.vehicle ?? "ثبت نشده"}</dd>
          <dt>توقف‌ها</dt><dd>{faNum(cover.stops)} توقف · {faNum(cover.pending)} مانده</dd>
          <dt>جمع سفارش‌ها</dt><dd>{cover.totalLabel}</dd>
          <dt>نقد قابل دریافت</dt><dd><strong>{cover.toCollectLabel}</strong></dd>
        </dl>
        <p>امضای تحویل‌دهندهٔ انبار: ____________ امضای راننده: ____________</p>
      </section>

      {notes.map((n, i) => (
        <section key={`${n.orderNo}-${i}`} className="run-notes__page">
          <h2>{n.businessName}</h2>
          <p>
            توقف {faNum(i + 1)} · سفارش {n.orderNo} · {n.dateLabel}
          </p>
          <p>
            <strong>{n.customerName}</strong>
            {n.address ? <><br />{n.address}</> : null}
            {n.phone ? <><br /><span dir="ltr">{n.phone}</span></> : null}
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {n.lines.map((l, j) => (
                <tr key={j} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td>{l.name}<br /><small>{l.detail}</small></td>
                  <td style={{ textAlign: "left" }}>{l.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            جمع: <strong>{n.totalLabel}</strong>
            <br />
            <small>{n.totalWords}</small>
          </p>
          <p>قابل دریافت: {n.dueLabel ?? n.totalLabel}</p>
          <p>نام و امضای تحویل‌گیرنده: ____________</p>
        </section>
      ))}
    </main>
  );
}
