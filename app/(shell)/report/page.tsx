import Link from "next/link";
import { getDb, District, Customer, CoverageStatus } from "@/lib/db";
import { STATUS_LABEL, STATUS_COLOR, LIFECYCLE_LABEL } from "@/lib/types";
import { readFacilities, pickOrigin } from "@/lib/facilities";
import { distanceKm } from "@/lib/geo";
import type { FacilityRow } from "@/lib/facilityTypes";
import { isPlaced } from "@/lib/facilityTypes";
import PrintButton from "@/components/PrintButton";
import CsvExportButton from "@/components/CsvExportButton";
import { faFixed, faNum } from "@/lib/format";
import DataFreshness from "@/components/DataFreshness";
import { newestSync } from "@/lib/freshness";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies, groupFilter, groupFilterWithShared } from "@/lib/session";
import { customerDebtsForOrg } from "@/lib/repo/payments";
import PageHeader from "@/components/meridian/PageHeader";
import { faJalaliDateTime } from "@/lib/jalali";
import { isVanRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

function countBy<T extends string>(items: T[]): Record<T, number> {
  const out = {} as Record<T, number>;
  for (const v of items) out[v] = (out[v] ?? 0) + 1;
  return out;
}

/** Nearest of our own sites to a point, or nulls when the point or the site list is
 *  missing. Shared by the coverage table and both CSV exports so a district and a
 *  customer are never measured against different sites. */
function nearestSite(
  point: { lat: number | null; lng: number | null },
  facilities: FacilityRow[]
): { name: string | null; km: number | null } {
  if (point.lat === null || point.lng === null || facilities.length === 0) {
    return { name: null, km: null };
  }
  const best = facilities
    .filter(isPlaced)
    .map((f) => ({ name: f.name, km: distanceKm({ lat: point.lat as number, lng: point.lng as number }, f) }))
    .sort((a, b) => a.km - b.km)[0];
  return best;
}

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ gaps?: string }>;
}) {
  const { gaps } = await searchParams;
  // Server-rendered page, so the sort lives in the URL rather than in client state --
  // which also means a sorted report stays sorted when printed or shared as a link.
  const sortByDistance = gaps === "near";
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (isVanRole(session.role)) redirect("/driver");
  // districts is shared reference data with no organization_id column, so the organisation
  // guard groupFilter adds for an owner would be an unknown column there (the page failed to
  // load for every owner); customers carry the column and keep the full guard.
  const fd = groupFilter(session, "group_id", { shared: true });
  const f = groupFilter(session);

  const db = getDb();
  const districts = db
    .prepare(`SELECT * FROM districts WHERE 1 = 1${fd.sql}`)
    .all(...fd.params) as unknown as District[];
  const customers = db
    .prepare(`SELECT * FROM customers WHERE 1 = 1${f.sql} ORDER BY business_name`)
    .all(...f.params) as unknown as Customer[];

  // Debt is computed from delivered orders and payment allocations now.
  const debtByCustomer = customerDebtsForOrg(session.organizationId);
  const debtOf = (id: number) =>
    debtByCustomer.get(id) ?? { total: 0, bucket_0_7: 0, bucket_8_30: 0, bucket_30_plus: 0 };

  const facilities = readFacilities(db, groupFilterWithShared(session));
  const origin = pickOrigin(facilities);

  const districtCounts = countBy(districts.map((d) => d.coverage_status));

  // Prospecting should start with the districts that are cheap to reach, which the
  // alphabetical default gives no way to see. Districts with no centroid sort last
  // rather than first -- an unknown distance is not a short one.
  const attention = districts
    .filter((d) => d.coverage_status === "needs_coverage" || d.coverage_status === "not_allowed")
    .map((d) => ({
      district: d,
      km:
        origin && d.centroid_lat !== null && d.centroid_lng !== null
          ? distanceKm({ lat: d.centroid_lat, lng: d.centroid_lng }, origin)
          : null,
    }))
    .sort((a, b) => {
      if (sortByDistance) {
        if (a.km === null) return b.km === null ? 0 : 1;
        if (b.km === null) return -1;
        return a.km - b.km;
      }
      return a.district.coverage_status.localeCompare(b.district.coverage_status);
    });

  const totalDebt = customers.reduce(
    (acc, c) => {
      const d = debtOf(c.id);
      acc.d0_7 += d.bucket_0_7;
      acc.d8_30 += d.bucket_8_30;
      acc.d30 += d.bucket_30_plus;
      return acc;
    },
    { d0_7: 0, d8_30: 0, d30: 0 }
  );

  const now = new Date();
  const generatedAt = faJalaliDateTime(now.toISOString());

  return (
    <>
    <PageHeader route="/report" />
    <div dir="rtl" className="print-report pagewrap">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div className="no-print flex items-center justify-between">
          <Link
            href="/map"
            className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-[length:var(--text-sm)] text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent hover:text-accent"
          >
            بازگشت به نقشه ←
          </Link>
          <div className="flex gap-2">
            <CsvExportButton
              customers={customers.map((c) => ({
                business_name: c.business_name,
                customer_code: c.customer_code,
                lifecycle: c.lifecycle,
                salesperson: c.salesperson,
                phone: c.phone,
                address: c.address,
                debt_0_7: debtOf(c.id).bucket_0_7,
                debt_8_30: debtOf(c.id).bucket_8_30,
                debt_30_plus: debtOf(c.id).bucket_30_plus,
                last_purchase_date: c.last_purchase_date,
                ...(() => {
                  const n = nearestSite(c, facilities);
                  return { nearest_site: n.name, nearest_site_km: n.km };
                })(),
              }))}
              districts={districts.map((d) => ({
                name: d.name,
                level: d.level,
                parent_name: d.parent_name,
                coverage_status: d.coverage_status,
                ...(() => {
                  const n = nearestSite({ lat: d.centroid_lat, lng: d.centroid_lng }, facilities);
                  return { nearest_site: n.name, nearest_site_km: n.km };
                })(),
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
          <p className="mt-1 inline-block font-mono text-[length:var(--text-xs)] text-text-faint">
            {generatedAt}
          </p>
          {/* The timestamp above is when this page was built; this is how old the
              numbers on it are. They are not the same question, and only the second one
              can be wrong. */}
          <DataFreshness syncedAt={newestSync(customers)} now={now} className="mt-1" />
        </div>

        <section>
          <h2 className="sechead__title mb-2">
            خلاصه وضعیت مناطق ({faNum(districts.length)} منطقه)
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
          <h2 className="sechead__title mb-2">
            جمع بدهی مشتریان
          </h2>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-[var(--radius-md)] border border-border bg-surface-raised p-3">
              <div className="font-mono text-[length:var(--text-md)] font-bold tabular-nums text-good">
                {faNum(totalDebt.d0_7)}
              </div>
              <div className="text-[length:var(--text-xs)] text-text-muted">زیر ۸ روز (تومان)</div>
            </div>
            <div className="rounded-[var(--radius-md)] border border-border bg-surface-raised p-3">
              <div className="font-mono text-[length:var(--text-md)] font-bold tabular-nums text-warn">
                {faNum(totalDebt.d8_30)}
              </div>
              <div className="text-[length:var(--text-xs)] text-text-muted">۸ تا ۳۰ روز (تومان)</div>
            </div>
            <div className="rounded-[var(--radius-md)] border border-border bg-surface-raised p-3">
              <div className="font-mono text-[length:var(--text-md)] font-bold tabular-nums text-crit">
                {faNum(totalDebt.d30)}
              </div>
              <div className="text-[length:var(--text-xs)] text-text-muted">بیش از ۳۰ روز (تومان)</div>
            </div>
          </div>
        </section>

        {attention.length > 0 && (
          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="sechead__title">
                مناطق نیازمند توجه ({faNum(attention.length)})
              </h2>
              {origin && (
                <div className="no-print flex items-center gap-1.5 text-[length:var(--text-xs)]">
                  <span className="text-text-faint">مرتب‌سازی:</span>
                  <Link
                    href="/report"
                    className={`rounded-[var(--radius-sm)] border px-2 py-0.5 transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] ${
                      sortByDistance ? "border-border text-text-muted hover:border-accent hover:text-accent" : "border-accent text-accent"
                    }`}
                  >
                    الفبا
                  </Link>
                  <Link
                    href="/report?gaps=near"
                    className={`rounded-[var(--radius-sm)] border px-2 py-0.5 transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] ${
                      sortByDistance ? "border-accent text-accent" : "border-border text-text-muted hover:border-accent hover:text-accent"
                    }`}
                  >
                    نزدیک‌ترین به {origin.name}
                  </Link>
                </div>
              )}
            </div>
            <div className="overflow-x-auto rounded-[var(--radius-md)] border border-border">
              <table className="w-full border-collapse text-[length:var(--text-sm)]">
                <thead>
                  <tr className="border-b border-border bg-surface text-right text-text-muted">
                    <th className="px-3 py-2 font-medium">نام</th>
                    <th className="px-3 py-2 font-medium">منطقه بالادست</th>
                    <th className="px-3 py-2 font-medium">وضعیت</th>
                    {origin && <th className="px-3 py-2 font-medium">فاصله (خط مستقیم)</th>}
                  </tr>
                </thead>
                <tbody>
                  {attention.map(({ district: d, km }) => (
                    <tr key={d.id} className="border-b border-border last:border-b-0">
                      <td className="px-3 py-2 text-text">{d.name}</td>
                      <td className="px-3 py-2 text-text-muted">{d.parent_name ?? "—"}</td>
                      <td className="px-3 py-2" style={{ color: STATUS_COLOR[d.coverage_status] }}>
                        {STATUS_LABEL[d.coverage_status]}
                      </td>
                      {origin && (
                        <td className="px-3 py-2 font-mono tabular-nums text-text-muted">
                          {km === null ? "—" : `${faFixed(km, 1)} کیلومتر`}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section>
          <h2 className="sechead__title mb-2">
            فهرست مشتریان ({faNum(customers.length)})
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
                    <td className="px-3 py-2 text-text-muted">{LIFECYCLE_LABEL[c.lifecycle]}</td>
                    <td className="px-3 py-2 text-text-muted">{c.salesperson ?? "—"}</td>
                    <td
                      dir="ltr"
                      className="px-3 py-2 text-right font-mono tabular-nums"
                      style={{ color: debtOf(c.id).bucket_30_plus > 0 ? STATUS_COLOR.not_allowed : "inherit" }}
                    >
                      {debtOf(c.id).bucket_30_plus > 0 ? faNum(debtOf(c.id).bucket_30_plus) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>    </>
  );
}
