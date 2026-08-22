import Link from "next/link";
import { getDb, District, Customer, CoverageStatus } from "@/lib/db";
import { STATUS_LABEL, STATUS_COLOR } from "@/lib/types";
import PrintButton from "@/components/PrintButton";
import CsvExportButton from "@/components/CsvExportButton";

export const dynamic = "force-dynamic";

function countBy<T extends string>(items: T[]): Record<T, number> {
  const out = {} as Record<T, number>;
  for (const v of items) out[v] = (out[v] ?? 0) + 1;
  return out;
}

export default function ReportPage() {
  const db = getDb();
  const districts = db.prepare("SELECT * FROM districts").all() as unknown as District[];
  const customers = db.prepare("SELECT * FROM customers ORDER BY business_name").all() as unknown as Customer[];

  const districtCounts = countBy(districts.map((d) => d.coverage_status));
  const attention = districts
    .filter((d) => d.coverage_status === "needs_coverage" || d.coverage_status === "not_allowed")
    .sort((a, b) => a.coverage_status.localeCompare(b.coverage_status));

  const totalDebt = customers.reduce(
    (acc, c) => {
      acc.d0_7 += c.debt_0_7;
      acc.d8_30 += c.debt_8_30;
      acc.d30 += c.debt_30_plus;
      return acc;
    },
    { d0_7: 0, d8_30: 0, d30: 0 }
  );

  const now = new Date();
  const generatedAt = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  return (
    <div dir="rtl" className="print-report min-h-screen bg-bg p-4 sm:p-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div className="no-print flex items-center justify-between">
          <Link
            href="/"
            className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-[length:var(--text-sm)] text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent hover:text-accent"
          >
            بازگشت به نقشه ←
          </Link>
          <div className="flex gap-2">
            <CsvExportButton
              customers={customers.map((c) => ({
                business_name: c.business_name,
                customer_code: c.customer_code,
                status: c.status,
                salesperson: c.salesperson,
                phone: c.phone,
                address: c.address,
                debt_0_7: c.debt_0_7,
                debt_8_30: c.debt_8_30,
                debt_30_plus: c.debt_30_plus,
                last_purchase_date: c.last_purchase_date,
              }))}
              districts={districts.map((d) => ({
                name: d.name,
                level: d.level,
                parent_name: d.parent_name,
                coverage_status: d.coverage_status,
                assigned_to: d.assigned_to,
              }))}
            />
            <PrintButton />
          </div>
        </div>

        <div>
          <div className="font-mono text-[length:var(--text-xs)] uppercase tracking-[0.12em] text-accent">
            Coverage Report
          </div>
          <h1 className="text-[length:var(--text-xl)] font-bold text-text">گزارش پوشش و مشتریان</h1>
          <p dir="ltr" className="mt-1 inline-block font-mono text-[length:var(--text-xs)] text-text-faint">
            {generatedAt}
          </p>
        </div>

        <section>
          <h2 className="mb-2 font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-muted">
            خلاصه وضعیت مناطق ({districts.length} منطقه)
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(Object.keys(STATUS_LABEL) as CoverageStatus[]).map((s) => (
              <div key={s} className="rounded-[var(--radius-md)] border border-border bg-surface-raised p-3">
                <div className="font-mono text-[length:var(--text-lg)] font-bold tabular-nums" style={{ color: STATUS_COLOR[s] }}>
                  {districtCounts[s] ?? 0}
                </div>
                <div className="text-[length:var(--text-xs)] text-text-muted">{STATUS_LABEL[s]}</div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-2 font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-muted">
            جمع بدهی مشتریان
          </h2>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-[var(--radius-md)] border border-border bg-surface-raised p-3">
              <div className="font-mono text-[length:var(--text-md)] font-bold tabular-nums text-good">
                {totalDebt.d0_7.toLocaleString("fa-IR")}
              </div>
              <div className="text-[length:var(--text-xs)] text-text-muted">زیر ۸ روز (تومان)</div>
            </div>
            <div className="rounded-[var(--radius-md)] border border-border bg-surface-raised p-3">
              <div className="font-mono text-[length:var(--text-md)] font-bold tabular-nums text-warn">
                {totalDebt.d8_30.toLocaleString("fa-IR")}
              </div>
              <div className="text-[length:var(--text-xs)] text-text-muted">۸ تا ۳۰ روز (تومان)</div>
            </div>
            <div className="rounded-[var(--radius-md)] border border-border bg-surface-raised p-3">
              <div className="font-mono text-[length:var(--text-md)] font-bold tabular-nums text-crit">
                {totalDebt.d30.toLocaleString("fa-IR")}
              </div>
              <div className="text-[length:var(--text-xs)] text-text-muted">بیش از ۳۰ روز (تومان)</div>
            </div>
          </div>
        </section>

        {attention.length > 0 && (
          <section>
            <h2 className="mb-2 font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-muted">
              مناطق نیازمند توجه ({attention.length})
            </h2>
            <div className="overflow-x-auto rounded-[var(--radius-md)] border border-border">
              <table className="w-full border-collapse text-[length:var(--text-sm)]">
                <thead>
                  <tr className="border-b border-border bg-surface text-right text-text-muted">
                    <th className="px-3 py-2 font-medium">نام</th>
                    <th className="px-3 py-2 font-medium">منطقه بالادست</th>
                    <th className="px-3 py-2 font-medium">وضعیت</th>
                    <th className="px-3 py-2 font-medium">مسئول</th>
                  </tr>
                </thead>
                <tbody>
                  {attention.map((d) => (
                    <tr key={d.id} className="border-b border-border last:border-b-0">
                      <td className="px-3 py-2 text-text">{d.name}</td>
                      <td className="px-3 py-2 text-text-muted">{d.parent_name ?? "—"}</td>
                      <td className="px-3 py-2" style={{ color: STATUS_COLOR[d.coverage_status] }}>
                        {STATUS_LABEL[d.coverage_status]}
                      </td>
                      <td className="px-3 py-2 text-text-muted">{d.assigned_to ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-2 font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-muted">
            فهرست مشتریان ({customers.length})
          </h2>
          <div className="overflow-x-auto rounded-[var(--radius-md)] border border-border">
            <table className="w-full border-collapse text-[length:var(--text-sm)]">
              <thead>
                <tr className="border-b border-border bg-surface text-right text-text-muted">
                  <th className="px-3 py-2 font-medium">نام</th>
                  <th className="px-3 py-2 font-medium">کد</th>
                  <th className="px-3 py-2 font-medium">وضعیت</th>
                  <th className="px-3 py-2 font-medium">فروشنده</th>
                  <th className="px-3 py-2 font-medium">بدهی &gt; ۳۰ روز</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-b-0">
                    <td className="px-3 py-2 text-text">{c.business_name}</td>
                    <td dir="ltr" className="px-3 py-2 text-right font-mono text-text-faint">
                      {c.customer_code}
                    </td>
                    <td className="px-3 py-2 text-text-muted">{c.status ?? "—"}</td>
                    <td className="px-3 py-2 text-text-muted">{c.salesperson ?? "—"}</td>
                    <td
                      dir="ltr"
                      className="px-3 py-2 text-right font-mono tabular-nums"
                      style={{ color: c.debt_30_plus > 0 ? STATUS_COLOR.not_allowed : "inherit" }}
                    >
                      {c.debt_30_plus > 0 ? c.debt_30_plus.toLocaleString("fa-IR") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
