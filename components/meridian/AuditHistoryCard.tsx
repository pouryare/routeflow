"use client";

import { useState } from "react";
import FilterChips from "@/components/mobile/FilterChips";
import { AUDIT_TABLES, auditLines, auditOp, auditTable } from "@/lib/auditLabels";
import { faJalaliDateTime } from "@/lib/jalali";
import type { AuditRow } from "@/lib/repo/auditLog";

/** E4: «تاریخچهٔ تغییرات», who changed what, for the owner. Prices, credit limits, roles, payments and the
 *  like; each line is one change with the old and new value. A filter by record kind sits above it. */
export default function AuditHistoryCard({ rows, title = "تاریخچهٔ تغییرات" }: { rows: AuditRow[]; title?: string }) {
  const [table, setTable] = useState("");
  const shown = table ? rows.filter((r) => r.table_name === table) : rows;
  return (
    <section className="card flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" dir="rtl" data-tour="audit-history">
      <h2 className="sechead__title">{title}</h2>
      <FilterChips
        groups={[
          {
            id: "table",
            label: "نوع",
            mode: "single",
            value: table,
            onChange: (v) => setTable(v as string),
            options: Object.entries(AUDIT_TABLES).map(([id, label]) => ({ id, label })),
          },
        ]}
      />
      {shown.length === 0 ? (
        <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">هنوز تغییری ثبت نشده است.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-[var(--space-2)] p-0 text-[length:var(--text-sm)]">
          {shown.map((r) => (
            <li key={r.id} className="flex flex-col gap-[var(--space-1)] border-b border-[var(--border)] pb-[var(--space-2)]">
              <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)]">
                <span className="font-medium text-[var(--foreground)]">
                  {auditTable(r.table_name)} <bdi className="tabular-nums">{r.row_id}</bdi> {auditOp(r.op)}
                </span>
                <bdi dir="ltr" className="tabular-nums text-[var(--muted)]">{faJalaliDateTime(r.created_at)}</bdi>
              </div>
              <span className="text-[var(--muted)]">
                {r.actor_name ?? "سیستم"}
                {r.impersonator_name ? ` (با ورود به‌جای او: ${r.impersonator_name})` : ""}
              </span>
              <ul className="m-0 list-none p-0">
                {auditLines(r.changes_json).map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
