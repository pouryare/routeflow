"use client";

import { useEffect, useState } from "react";
import { friendlyError } from "@/lib/userMessage";

import { Icon } from "@/components/meridian/Icon";
interface MarginRow {
  key: string;
  label: string;
  revenue_toman: number;
  cost_toman: number;
  margin_toman: number;
  margin_pct: number;
  share_pct: number;
}

const DIMS: { key: string; label: string }[] = [
  { key: "customer", label: "مشتری" },
  { key: "product", label: "کالا" },
  { key: "phone_sales", label: "فروشنده" },
  { key: "group", label: "منطقه" },
  { key: "representative", label: "نماینده" },
];

const fa = (n: number) => Math.round(n).toLocaleString("fa-IR");

interface Loaded {
  dim: string;
  period: string;
  rows: MarginRow[] | null;
  err: string | null;
}

/** Contribution margin by dimension — margin % beside revenue so a high-revenue,
 *  low-margin row is visible at a glance. Manager+ only (the page omits it otherwise). */
export default function MarginTable({ period }: { period: string }) {
  const [dim, setDim] = useState("customer");
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/analysis/margin?dimension=${dim}&period=${period}`)
      .then((r) => r.json())
      .then((j) => {
        if (!live) return;
        setLoaded({
          dim,
          period,
          rows: j.ok ? (j.rows as MarginRow[]) : null,
          err: j.ok ? null : (friendlyError(j.error, "داده‌ها بارگذاری نشد؛ دوباره تلاش کنید")),
        });
      })
      .catch(() => live && setLoaded({ dim, period, rows: null, err: "داده‌ها بارگذاری نشد؛ دوباره تلاش کنید" }));
    return () => {
      live = false;
    };
  }, [dim, period]);

  const fresh = loaded && loaded.dim === dim && loaded.period === period;
  const rows = fresh ? loaded.rows : null;
  const err = fresh ? loaded.err : null;

  return (
    <div className="kblock" dir="rtl">
      <div className="bhead">
        <h2>حاشیهٔ مشارکتی</h2>
        <div className="flex gap-[var(--space-1)]">
          {DIMS.map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => setDim(d.key)}
              className="cursor-pointer rounded-[var(--radius-sm)] border px-[var(--space-2)] py-[2px] text-[length:var(--text-xs)]"
              style={{
                borderColor: dim === d.key ? "var(--accent)" : "var(--border)",
                color: dim === d.key ? "var(--accent)" : "var(--text-muted)",
              }}
            >
              <Icon name="chart" size="sm" />
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {err && <p className="text-[length:var(--text-sm)] text-[var(--crit)]">{err}</p>}
      {!err && rows === null && <p className="text-[length:var(--text-sm)] text-[var(--text-faint)]">…</p>}
      {rows && rows.length === 0 && (
        <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">داده‌ای برای این دوره نیست.</p>
      )}
      {rows && rows.length > 0 && (
        <div className="kblock__body overflow-x-auto">
          <table className="w-full border-collapse text-[length:var(--text-sm)]">
            <thead>
              <tr className="text-[var(--text-muted)]">
                <th className="border-b border-[var(--border)] py-1 text-right font-medium">نام</th>
                <th className="border-b border-[var(--border)] py-1 text-left font-medium">فروش</th>
                <th className="border-b border-[var(--border)] py-1 text-left font-medium">سود</th>
                <th className="border-b border-[var(--border)] py-1 text-left font-medium">حاشیه</th>
                <th className="border-b border-[var(--border)] py-1 text-left font-medium">سهم سود</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="border-b border-[var(--border)] py-1 text-[var(--text)]">{r.label}</td>
                  <td className="border-b border-[var(--border)] py-1 text-left tabular-nums text-[var(--text-muted)]">
                    {fa(r.revenue_toman)}
                  </td>
                  <td
                    className="border-b border-[var(--border)] py-1 text-left tabular-nums"
                    style={{ color: r.margin_toman < 0 ? "var(--crit)" : "var(--text)" }}
                  >
                    {fa(r.margin_toman)}
                  </td>
                  <td
                    className="border-b border-[var(--border)] py-1 text-left tabular-nums"
                    style={{ color: r.margin_pct < 0.1 ? "var(--warn)" : "var(--text-muted)" }}
                  >
                    {Math.round(r.margin_pct * 100).toLocaleString("fa-IR")}٪
                  </td>
                  <td className="border-b border-[var(--border)] py-1 text-left tabular-nums text-[var(--text-muted)]">
                    {Math.round(r.share_pct * 100).toLocaleString("fa-IR")}٪
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
