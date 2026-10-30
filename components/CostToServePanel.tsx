"use client";

import CardTable from "@/components/CardTable";
import { FieldInput } from "@/components/FieldInput";
import { useMemo, useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import { useHydrated } from "@/lib/useHydrated";
import { toCsv } from "@/lib/csv";
import { useToast } from "./ToastProvider";
import { faFixed, faNum } from "@/lib/format";

export interface CostToServeRow {
  business_name: string;
  customer_code: string;
  /** Straight-line km from the dispatch site. Null when the customer has no coordinates. */
  km: number | null;
  /** Total sales amount matched to this customer, in تومان. */
  revenue: number;
}

/** How many sales rows failed to match any customer, and what they were worth. Sales
 *  link to customers by business name as free text, so a renamed or differently-spelled
 *  business silently vanishes from this analysis -- surfaced rather than absorbed. */
export interface MatchQuality {
  unmatchedRows: number;
  totalRows: number;
  unmatchedRevenue: number;
  /** False when the reader's scope cannot see the unmatched rows at all, so
   *  `unmatchedRows: 0` means "not measurable here", NOT "nothing is unmatched".
   *  The `sales` table predates tenancy and carries no organization_id, so the only
   *  tenancy it has is the join to `customers` — and that join drops the very rows this
   *  figure counts. See lib/repo/coverageAnalytics.ts. */
  measurable: boolean;
}

const COST_PER_KM_KEY = "coverage_cost_per_km";

function readSavedCost(): string {
  try {
    return localStorage.getItem(COST_PER_KM_KEY) ?? "";
  } catch {
    return "";
  }
}

export default function CostToServePanel({
  rows,
  originName,
  match,
}: {
  rows: CostToServeRow[];
  originName: string | null;
  match: MatchQuality;
}) {
  const [costPerKm, setCostPerKm] = useState("");
  const [sortBy, setSortBy] = useState<"revenue" | "km" | "ratio">("ratio");
  const toast = useToast();

  /* Adopted on the first render after hydration, not in an effect: localStorage does not
     exist on the server, and reading it on the hydrating render would disagree with the
     server's HTML. The flag makes it happen exactly once. */
  const hydrated = useHydrated();
  const [restored, setRestored] = useState(false);
  if (hydrated && !restored) {
    setRestored(true);
    setCostPerKm(readSavedCost());
  }

  function updateCost(value: string) {
    setCostPerKm(value);
    localStorage.setItem(COST_PER_KM_KEY, value);
  }

  const cost = Number(costPerKm);
  const hasCost = costPerKm.trim() !== "" && Number.isFinite(cost) && cost > 0;

  const analysed = useMemo(() => {
    return rows
      .map((r) => {
        // A round trip: you drive out and you drive back.
        const tripCost = hasCost && r.km !== null ? r.km * 2 * cost : null;
        const ratio = r.km !== null && r.km > 0 ? r.revenue / r.km : null;
        return { ...r, tripCost, ratio, margin: tripCost === null ? null : r.revenue - tripCost };
      })
      .sort((a, b) => {
        if (sortBy === "revenue") return b.revenue - a.revenue;
        if (sortBy === "km") return (b.km ?? -1) - (a.km ?? -1);
        // Cheapest-to-serve last: the ones worth looking at are the poor ratios.
        return (a.ratio ?? Infinity) - (b.ratio ?? Infinity);
      });
  }, [rows, hasCost, cost, sortBy]);

  const withRevenue = rows.filter((r) => r.revenue > 0).length;

  function exportCsv() {
    const csv = toCsv([
      [
        "نام کسب‌وکار",
        "کد مشتری",
        `فاصله از ${originName ?? "مبدأ"} (کیلومتر، خط مستقیم)`,
        "فروش (تومان)",
        "فروش به ازای هر کیلومتر",
        ...(hasCost ? ["هزینه رفت‌وبرگشت (تومان)", "خالص (تومان)"] : []),
      ],
      ...analysed.map((r) => [
        r.business_name,
        r.customer_code,
        r.km === null ? "" : r.km.toFixed(1),
        r.revenue,
        r.ratio === null ? "" : Math.round(r.ratio),
        ...(hasCost ? [r.tripCost === null ? "" : Math.round(r.tripCost), r.margin === null ? "" : Math.round(r.margin)] : []),
      ]),
    ]);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "هزینه-خدمات-رسانی.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast(`CSV با ${faNum(analysed.length)} ردیف دانلود شد.`, "success");
  }

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="sechead__title">
          هزینه خدمات‌رسانی
        </h2>
        {withRevenue > 0 && (
          <button
            onClick={exportCsv}
            className="inline-flex items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent hover:text-accent"
          >
            <Icon name="download" size="sm" />
            CSV
          </button>
        )}
      </div>

      {/* The honest empty state. With no sales history this table would be a wall of
          zeros that looks like an answer -- worse than saying there is nothing to show. */}
      {withRevenue === 0 ? (
        <div className="rounded-[var(--radius-md)] border border-border bg-surface p-4">
          <p className="text-[length:var(--text-sm)] leading-6 text-text-muted">
            هنوز فروشی ثبت نشده که بتوان آن را با مشتری‌ها تطبیق داد
            {match.totalRows > 0 && ` (${faNum(match.totalRows)} ردیف فروش موجود است، اما هیچ‌کدام با نام مشتری‌های نقشه مطابقت ندارد)`}
            . پس از ثبت سفارش‌ها در برگه «فروش» و به‌روزرسانی از اکسل، این بخش نسبت فروش هر
            مشتری به فاصله‌اش را نشان می‌دهد.
          </p>
          {match.totalRows > 0 && (
            <p className="mt-2 text-[length:var(--text-xs)] leading-5 text-warn">
              نام مشتری در برگه «فروش» باید دقیقاً با نام همان مشتری در برگه «مخاطبین» یکسان باشد،
              وگرنه آن فروش در این تحلیل دیده نمی‌شود.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-[length:var(--text-xs)] text-text-muted">
              هزینه هر کیلومتر (تومان)
              <FieldInput
                value={costPerKm}
                onChange={(e) => updateCost(e.target.value)}
                inputMode="numeric"
                placeholder="مثلاً ۵۰۰۰"
                className="w-28 font-mono text-[length:var(--text-xs)] text-text"
              />
            </label>
            <div className="flex gap-1 rounded-[var(--radius-md)] border border-border bg-surface p-1">
              {(
                [
                  ["ratio", "کم‌بازده‌ترین"],
                  ["revenue", "بیشترین فروش"],
                  ["km", "دورترین"],
                ] as [typeof sortBy, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setSortBy(key)}
                  className={`rounded-[var(--radius-sm)] px-2 py-1 text-[length:var(--text-xs)] transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] ${
                    sortBy === key ? "bg-accent font-medium text-accent-ink" : "text-text-muted hover:bg-white/5 hover:text-text"
                  }`}
                >
                  <Icon name="arrow-up" size="sm" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {!hasCost && (
            <p className="mb-2 text-[length:var(--text-xs)] leading-5 text-text-faint">
              تا وقتی هزینه هر کیلومتر را وارد نکنید، فقط نسبت خام فروش به فاصله نمایش داده می‌شود —
              هیچ عدد پیش‌فرضی برای آن وجود ندارد که بتوان به آن تکیه کرد.
            </p>
          )}

          {!match.measurable && (
            <p className="mb-2 text-[length:var(--text-xs)] leading-5 text-text-faint">
              ردیف‌های فروشی که با هیچ مشتری تطبیق نشده‌اند در این سطح دسترسی قابل شمارش نیستند —
              ارقام زیر فقط فروش‌های تطبیق‌شده را در بر می‌گیرند.
            </p>
          )}

          {match.unmatchedRows > 0 && (
            <p className="mb-2 text-[length:var(--text-xs)] leading-5 text-warn">
              {faNum(match.unmatchedRows)} ردیف فروش با هیچ مشتری تطبیق نشد
              {match.unmatchedRevenue > 0 && ` (${faNum(Math.round(match.unmatchedRevenue))} تومان)`} — نام آن‌ها در
              برگه «فروش» با برگه «مخاطبین» یکسان نیست و در ارقام زیر دیده نمی‌شود.
            </p>
          )}

          <div className="overflow-x-auto rounded-[var(--radius-md)] border border-border">
            <CardTable className="w-full border-collapse text-[length:var(--text-sm)]">
              <thead>
                <tr className="border-b border-border bg-surface text-right text-text-muted">
                  <th className="px-3 py-2 font-medium">مشتری</th>
                  <th className="px-3 py-2 font-medium">فاصله (خط مستقیم)</th>
                  <th className="px-3 py-2 font-medium">فروش</th>
                  <th className="px-3 py-2 font-medium">فروش بر کیلومتر</th>
                  {hasCost && <th className="px-3 py-2 font-medium">خالص پس از هزینه سفر</th>}
                </tr>
              </thead>
              <tbody>
                {analysed.map((r) => (
                  <tr key={r.customer_code} className="border-b border-border last:border-b-0">
                    <td className="px-3 py-2 text-text">{r.business_name}</td>
                    <td className="px-3 py-2 font-mono tabular-nums text-text-muted">
                      {r.km === null ? "—" : `${faFixed(r.km, 1)} کیلومتر`}
                    </td>
                    <td className="px-3 py-2 font-mono tabular-nums text-text-muted">{faNum(r.revenue)}</td>
                    <td className="px-3 py-2 font-mono tabular-nums text-text-muted">
                      {r.ratio === null ? "—" : faNum(Math.round(r.ratio))}
                    </td>
                    {hasCost && (
                      <td
                        className="px-3 py-2 font-mono tabular-nums"
                        style={{ color: r.margin !== null && r.margin < 0 ? "var(--crit)" : "var(--text-muted)" }}
                      >
                        {r.margin === null ? "—" : faNum(Math.round(r.margin))}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </CardTable>
          </div>
        </>
      )}
    </section>
  );
}
