"use client";

import { useEffect, useState } from "react";
import { Table, type SortDescriptor } from "@heroui/react";
import { friendlyError } from "@/lib/userMessage";

import { Icon } from "@/components/meridian/Icon";
import { sortRows, visibleRows } from "@/components/analysis/marginRows";
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

const COLS: { id: keyof MarginRow; label: string }[] = [
  { id: "label", label: "نام" },
  { id: "revenue_toman", label: "فروش" },
  { id: "margin_toman", label: "سود" },
  { id: "margin_pct", label: "حاشیه" },
  { id: "share_pct", label: "سهم سود" },
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
  // Which breakdown the reader expanded, so switching tabs starts compact again.
  const [expandedDim, setExpandedDim] = useState<string | null>(null);
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
  // Sorted here, in the browser: the rows are already all loaded, so no round trip.
  const [sort, setSort] = useState<SortDescriptor | undefined>(undefined);
  const sorted = sortRows(rows ?? [], sort);
  const { shown, hidden } = visibleRows(sorted, expandedDim === dim);

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
              className="cursor-pointer rounded-[var(--radius-sm)] border px-[var(--space-2)] py-[2px] touch text-[length:var(--text-xs)]"
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
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label="حاشیهٔ مشارکتی" sortDescriptor={sort} onSortChange={setSort}>
                <Table.Header>
                  {COLS.map((c, i) => (
                    <Table.Column key={c.id} id={c.id} isRowHeader={i === 0} allowsSorting>
                      {({ sortDirection }) => <Table.SortableColumnHeader sortDirection={sortDirection}>{c.label}</Table.SortableColumnHeader>}
                    </Table.Column>
                  ))}
                </Table.Header>
                <Table.Body>
                  {shown.map((r) => (
                    <Table.Row key={r.key} id={r.key}>
                      <Table.Cell>{r.label}</Table.Cell>
                      <Table.Cell className="tabular-nums">{fa(r.revenue_toman)}</Table.Cell>
                      <Table.Cell className="tabular-nums" style={{ color: r.margin_toman < 0 ? "var(--crit)" : undefined }}>
                        {fa(r.margin_toman)}
                      </Table.Cell>
                      <Table.Cell className="tabular-nums" style={{ color: r.margin_pct < 0.1 ? "var(--warn)" : undefined }}>
                        {Math.round(r.margin_pct * 100).toLocaleString("fa-IR")}٪
                      </Table.Cell>
                      <Table.Cell className="tabular-nums">{Math.round(r.share_pct * 100).toLocaleString("fa-IR")}٪</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setExpandedDim(dim)}
              className="mt-[var(--space-2)] cursor-pointer rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] py-[2px] touch text-[length:var(--text-xs)] text-[var(--text-muted)]"
            >
              <Icon name="chevron-down" size="sm" />
              نمایش {fa(hidden)} ردیف دیگر
            </button>
          )}
        </div>
      )}
    </div>
  );
}
